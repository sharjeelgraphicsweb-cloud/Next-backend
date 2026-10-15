import { Collection, Document, ObjectId, Filter, OptionalUnlessRequiredId, UpdateFilter } from 'mongodb';
import mongoose, { Model, Schema } from 'mongoose';

export type RawMongoDocument = Document & { _id?: ObjectId | string };

export function collection<T extends Document = RawMongoDocument>(name: string): Collection<T> {
  const modelName = `Backend2_${name}`;
  const model = (mongoose.models[modelName] as Model<T> | undefined)
    || mongoose.model<T>(
      modelName,
      new Schema<T>({}, {
        collection: name,
        strict: false,
        versionKey: false,
        autoIndex: false,
        timestamps: false,
      }),
      name,
    );
  // Mongoose's empty strict:false schema preserves the legacy collection's arbitrary nested documents.
  return model.collection as unknown as Collection<T>;
}

export function mongoId(id: string): ObjectId | string {
  return ObjectId.isValid(id) && new ObjectId(id).toHexString() === id.toLowerCase()
    ? new ObjectId(id)
    : id;
}

export function idFilter<T extends Document = Document>(id: string): Filter<T> {
  const converted = mongoId(id);
  return { _id: converted } as Filter<T>;
}

export async function findById<T extends Document = RawMongoDocument>(name: string, id: string): Promise<T | null> {
  return await collection<T>(name).findOne(idFilter<T>(id)) as T | null;
}

export async function insertDocument<T extends Document = RawMongoDocument>(
  name: string,
  document: OptionalUnlessRequiredId<T>,
): Promise<T> {
  const result = await collection<T>(name).insertOne(document);
  return { ...document, _id: result.insertedId } as T;
}

export async function updateById<T extends Document = RawMongoDocument>(
  name: string,
  id: string,
  update: UpdateFilter<T>,
): Promise<boolean> {
  const result = await collection<T>(name).updateOne(idFilter<T>(id), update);
  return result.matchedCount > 0;
}
