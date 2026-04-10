import { SettingItem } from "@/components/ui/setting-item";
import { updateSetting, useSettingsValue } from "@/settings/model";
import React from "react";

/**
 * Settings section for long-term memory configuration.
 * Renders the enable toggle and sub-settings when enabled.
 */
export const MemorySettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <>
      <SettingItem
        type="switch"
        title="Long-Term Memory"
        description="Automatically extract and remember facts, preferences, and context from your conversations. Memories are stored locally and used to personalize future responses."
        checked={settings.enableLongTermMemory}
        onCheckedChange={(checked) => {
          updateSetting("enableLongTermMemory", checked);
        }}
      />

      {settings.enableLongTermMemory && (
        <>
          <SettingItem
            type="slider"
            title="Max Stored Memories"
            description="Maximum number of long-term memories to keep. Oldest and least-accessed memories are pruned when this limit is exceeded."
            min={100}
            max={10000}
            step={100}
            value={settings.maxLongTermMemories}
            onChange={(value) => updateSetting("maxLongTermMemories", value)}
          />

          <SettingItem
            type="slider"
            title="Max Retrieved Memories"
            description="Maximum number of relevant memories to include in each conversation's context."
            min={1}
            max={50}
            step={1}
            value={settings.maxMemoriesRetrieved}
            onChange={(value) => updateSetting("maxMemoriesRetrieved", value)}
          />

          <SettingItem
            type="slider"
            title="Deduplication Threshold"
            description="Similarity threshold (0.5-1.0) for detecting duplicate memories. Higher values require closer matches to merge."
            min={0.5}
            max={1.0}
            step={0.05}
            value={settings.memoryDeduplicationThreshold}
            onChange={(value) => updateSetting("memoryDeduplicationThreshold", value)}
            suffix=""
          />
        </>
      )}
    </>
  );
};
