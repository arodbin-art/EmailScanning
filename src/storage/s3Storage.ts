import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { ObjectGetOutput, ObjectPutInput, ObjectStorage } from "./objectStorage.js"

type S3StorageConfig = {
  region: string
  bucket: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    })
  }

  async putObject(input: ObjectPutInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      })
    )
  }

  async getObject(key: string): Promise<ObjectGetOutput> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    )
    const body = await this.streamToBuffer(response.Body)
    return {
      body,
      contentType: response.ContentType ?? undefined,
      metadata: response.Metadata ?? undefined,
    }
  }

  async headObject(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      )
      return true
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 404) {
        return false
      }
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    )
  }

  private async streamToBuffer(body: unknown): Promise<Buffer> {
    if (!body) {
      return Buffer.alloc(0)
    }
    if (body instanceof Uint8Array) {
      return Buffer.from(body)
    }
    if (typeof body === "string") {
      return Buffer.from(body)
    }
    const stream = body as NodeJS.ReadableStream
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
}
