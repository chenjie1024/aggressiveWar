// 存储后端抽象（core 不依赖 DOM/网络，具体实现放 web / server）

export interface StorageBackend {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const SAVE_KEY_PREFIX = 'gongfa-war:';
