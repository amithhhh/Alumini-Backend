import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memory;

/**
 * Connects to an ISOLATED test database: either TEST_MONGODB_URI (db name must end in "_test") or a
 * throw-away in-memory MongoDB. It refuses to touch anything else, so tests can never hit production data.
 */
export async function connectTestDb() {
  let uri = process.env.TEST_MONGODB_URI;
  if (uri) {
    const dbName = new URL(uri).pathname.replace('/', '');
    if (!/_test$/.test(dbName)) throw new Error(`Refusing to run tests against "${dbName}": test database names must end in _test`);
  } else {
    memory = await MongoMemoryServer.create();
    uri = memory.getUri('alumni_portal_test');
  }
  await mongoose.connect(uri);
  // Real MongoDB builds every index. Some Mongo-compatible servers (e.g. FerretDB, used when no mongod
  // binary can be downloaded) lack TTL indexes; tolerate exactly that, nothing else.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch((e) => {
    if (!/not implemented yet/i.test(e.message)) throw e;
  })));
}

export async function clearDb() {
  if (!/_test$/.test(mongoose.connection.name)) throw new Error('clearDb() called on a non-test database');
  await Promise.all(Object.values(mongoose.models).map((m) => m.collection.deleteMany({})));
}

export async function closeTestDb() {
  await mongoose.disconnect();
  if (memory) await memory.stop();
}
