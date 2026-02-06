import { BlobServiceClient } from "@azure/storage-blob"
import { ObjectGetOutput, ObjectPutInput, ObjectStorage } from "./objectStorage.js"

type AzureBlobStorageConfig = {
  connectionString: string
  containerName: string
}

export class AzureBlobStorage implements ObjectStorage {
  private readonly containerClient

  constructor(config: AzureBlobStorageConfig) {
    const serviceClient = BlobServiceClient.fromConnectionString(config.connectionString)
    this.containerClient = serviceClient.getContainerClient(config.containerName)
  }

  async putObject(input: ObjectPutInput): Promise<void> {
    const blockBlob = this.containerClient.getBlockBlobClient(input.key)
    await this.containerClient.createIfNotExists()
    const body = typeof input.body === "string" ? Buffer.from(input.body) : input.body
    await blockBlob.uploadData(body, {
      blobHTTPHeaders: input.contentType ? { blobContentType: input.contentType } : undefined,
      metadata: input.metadata,
    })
  }

  async getObject(key: string): Promise<ObjectGetOutput> {
    const blob = this.containerClient.getBlobClient(key)
    const response = await blob.download()
    const body = await this.streamToBuffer(response.readableStreamBody ?? null)
    return {
      body,
      contentType: response.contentType ?? undefined,
      metadata: response.metadata ?? undefined,
    }
  }

  async headObject(key: string): Promise<boolean> {
    const blob = this.containerClient.getBlobClient(key)
    return blob.exists()
  }

  async deleteObject(key: string): Promise<void> {
    const blob = this.containerClient.getBlobClient(key)
    await blob.deleteIfExists()
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream | null): Promise<Buffer> {
    if (!stream) {
      return Buffer.alloc(0)
    }
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
}
