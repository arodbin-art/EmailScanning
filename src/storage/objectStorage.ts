export type ObjectPutInput = {
  key: string
  body: Buffer | Uint8Array | string
  contentType?: string
  metadata?: Record<string, string>
}

export type ObjectGetOutput = {
  body: Buffer
  contentType?: string
  metadata?: Record<string, string>
}

export interface ObjectStorage {
  putObject(input: ObjectPutInput): Promise<void>
  getObject(key: string): Promise<ObjectGetOutput>
  headObject(key: string): Promise<boolean>
  deleteObject(key: string): Promise<void>
}
