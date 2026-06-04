import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1'
});

const S3_BUCKET = process.env.S3_DB_BUCKET;
const DB_KEY = 'db.json';

export async function loadDbFromS3OrLocal(localPath: string): Promise<any> {
  if (S3_BUCKET) {
    try {
      console.log(`[DB] Fetching db.json from S3 bucket ${S3_BUCKET}...`);
      const { Body } = await s3Client.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: DB_KEY
      }));
      const str = await Body?.transformToString();
      if (str) return JSON.parse(str);
    } catch (err: any) {
      console.log(`[DB] S3 load error (might be a fresh DB): ${err.message}`);
    }
    return {};
  } else {
    if (fs.existsSync(localPath)) {
      return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
    }
    return {};
  }
}

export async function saveDbToS3OrLocal(data: any, localPath: string): Promise<void> {
  if (S3_BUCKET) {
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: DB_KEY,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json'
    }));
  } else {
    fs.writeFileSync(localPath, JSON.stringify(data, null, 2));
  }
}
