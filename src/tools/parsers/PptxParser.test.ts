import JSZip from "jszip";
import { PptxParser } from "@/tools/parsers/PptxParser";

interface TestShape {
  paragraphs: string[];
  placeholderType?: string;
}

interface TestSlide {
  shapes?: TestShape[];
  notesShapes?: TestShape[];
}

const FIXED_CONVERSION_DATE = "2024-01-02T03:04:05.000Z";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createShapeXml(shape: TestShape, index: number): string {
  const placeholderXml = shape.placeholderType
    ? `<p:ph type="${escapeXml(shape.placeholderType)}"/>`
    : "";
  const paragraphXml = shape.paragraphs
    .map(
      (paragraph) => `
        <a:p>
          <a:r>
            <a:t>${escapeXml(paragraph)}</a:t>
          </a:r>
        </a:p>
      `
    )
    .join("");

  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${index + 1}" name="Shape ${index + 1}"/>
        <p:cNvSpPr/>
        <p:nvPr>${placeholderXml}</p:nvPr>
      </p:nvSpPr>
      <p:spPr/>
      <p:txBody>
        <a:bodyPr/>
        <a:lstStyle/>
        ${paragraphXml}
      </p:txBody>
    </p:sp>
  `;
}

function createSlideXml(shapes: TestShape[]): string {
  const shapesXml = shapes.map((shape, index) => createShapeXml(shape, index)).join("");

  return `
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
    >
      <p:cSld>
        <p:spTree>
          ${shapesXml}
        </p:spTree>
      </p:cSld>
    </p:sld>
  `;
}

function createNotesXml(shapes: TestShape[]): string {
  const shapesXml = shapes.map((shape, index) => createShapeXml(shape, index)).join("");

  return `
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:notes
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
    >
      <p:cSld>
        <p:spTree>
          ${shapesXml}
        </p:spTree>
      </p:cSld>
    </p:notes>
  `;
}

async function createPptxBuffer(slides: TestSlide[]): Promise<ArrayBuffer> {
  const zip = new JSZip();

  const slideIdListXml = slides
    .map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
    .join("");
  const presentationRelationshipsXml = slides
    .map(
      (_slide, index) => `
        <Relationship
          Id="rId${index + 1}"
          Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
          Target="slides/slide${index + 1}.xml"
        />
      `
    )
    .join("");

  zip.file(
    "ppt/presentation.xml",
    `
      <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation
        xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      >
        <p:sldIdLst>${slideIdListXml}</p:sldIdLst>
      </p:presentation>
    `
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `
      <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        ${presentationRelationshipsXml}
      </Relationships>
    `
  );

  slides.forEach((slide, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, createSlideXml(slide.shapes ?? []));

    if (slide.notesShapes && slide.notesShapes.length > 0) {
      zip.file(
        `ppt/slides/_rels/slide${index + 1}.xml.rels`,
        `
          <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship
              Id="rId1"
              Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
              Target="../notesSlides/notesSlide${index + 1}.xml"
            />
          </Relationships>
        `
      );
      zip.file(`ppt/notesSlides/notesSlide${index + 1}.xml`, createNotesXml(slide.notesShapes));
    }
  });

  return zip.generateAsync({ type: "arraybuffer" });
}

describe("PptxParser", () => {
  beforeEach(() => {
    jest.spyOn(Date.prototype, "toISOString").mockReturnValue(FIXED_CONVERSION_DATE);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("extracts content from multiple slides in presentation order", async () => {
    const parser = new PptxParser();
    const fileBuffer = await createPptxBuffer([
      {
        shapes: [
          { placeholderType: "title", paragraphs: ["Quarterly roadmap"] },
          { paragraphs: ["Launch self-serve onboarding", "Reduce setup friction"] },
        ],
      },
      {
        shapes: [{ paragraphs: ["Next steps", "Measure activation weekly"] }],
      },
    ]);

    const result = await parser.parse(fileBuffer, "roadmap.pptx", {});

    expect(result).toEqual({
      status: "success",
      content:
        "## Slide 1\n\nQuarterly roadmap\n\nLaunch self-serve onboarding\nReduce setup friction\n\n## Slide 2\n\nNext steps\nMeasure activation weekly",
      metadata: {
        title: "Quarterly roadmap",
        sourceFilename: "roadmap.pptx",
        sourceFormat: "pptx",
        pageCount: 2,
        wordCount: 19,
        conversionDate: FIXED_CONVERSION_DATE,
        ocrUsed: false,
      },
      errors: [],
    });
  });

  it("uses the first detected slide title as metadata title", async () => {
    const parser = new PptxParser();
    const fileBuffer = await createPptxBuffer([
      {
        shapes: [{ paragraphs: ["This slide has body text only"] }],
      },
      {
        shapes: [
          { placeholderType: "ctrTitle", paragraphs: ["Executive summary"] },
          { paragraphs: ["Revenue increased 32 percent"] },
        ],
      },
    ]);

    const result = await parser.parse(fileBuffer, "earnings-update.pptx", {});

    expect(result.status).toBe("success");
    expect(result.metadata.title).toBe("Executive summary");
    expect(result.metadata.sourceFilename).toBe("earnings-update.pptx");
    expect(result.metadata.pageCount).toBe(2);
  });

  it("formats speaker notes as blockquotes and ignores empty note placeholders", async () => {
    const parser = new PptxParser();
    const fileBuffer = await createPptxBuffer([
      {
        shapes: [{ placeholderType: "title", paragraphs: ["Launch plan"] }],
        notesShapes: [
          {
            placeholderType: "body",
            paragraphs: ["Open with the customer story", "Emphasize ROI"],
          },
          { placeholderType: "hdr", paragraphs: ["Presenter header should be ignored"] },
        ],
      },
    ]);

    const result = await parser.parse(fileBuffer, "launch-plan.pptx", {});

    expect(result.status).toBe("success");
    expect(result.content).toContain("## Slide 1\n\nLaunch plan");
    expect(result.content).toContain("> Open with the customer story\n> Emphasize ROI");
    expect(result.content).not.toContain("Presenter header should be ignored");
  });

  it("preserves empty slides without inventing body content", async () => {
    const parser = new PptxParser();
    const fileBuffer = await createPptxBuffer([
      {
        shapes: [],
      },
      {
        shapes: [{ paragraphs: ["Only the second slide has content"] }],
      },
    ]);

    const result = await parser.parse(fileBuffer, "blank-divider.pptx", {});

    expect(result.status).toBe("success");
    expect(result.content).toBe("## Slide 1\n\n## Slide 2\n\nOnly the second slide has content");
    expect(result.metadata.title).toBe("blank-divider");
    expect(result.metadata.pageCount).toBe(2);
  });
});
