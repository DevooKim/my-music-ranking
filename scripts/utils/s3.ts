import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { BUCKET, REGION } from "./config";

export const s3Client = new S3Client({ region: REGION });

export interface ListKeysOptions {
  maxKeys?: number;
  continuationToken?: string;
}

export async function listAllKeys(prefix: string, options: ListKeysOptions = {}): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined = options.continuationToken;

  do {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    const batch = response.Contents?.map((object) => object.Key).filter((key): key is string => Boolean(key)) ?? [];
    keys.push(...batch);

    if (options.maxKeys && keys.length >= options.maxKeys) {
      return keys.slice(0, options.maxKeys);
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

export async function getObjectBody(key: string): Promise<string | null> {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));

  const body = await response.Body?.transformToString();
  return body ?? null;
}
