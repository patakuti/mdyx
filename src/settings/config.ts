import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  plantumlServerUrl: string;
}

export function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}
