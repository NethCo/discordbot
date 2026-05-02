const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");

let bucket = null;

function getGridFS() {
  if (!bucket) {
    const db = mongoose.connection.db;
    bucket = new GridFSBucket(db, { bucketName: "verifications" });
  }
  return bucket;
}

async function uploadScreenshot(buffer, filename, metadata = {}) {
  const gridfs = getGridFS();
  const uploadStream = gridfs.openUploadStream(filename, { metadata });
  
  return new Promise((resolve, reject) => {
    uploadStream.end(buffer, (err) => {
      if (err) return reject(err);
      resolve(uploadStream.id.toString());
    });
  });
}

async function deleteScreenshot(fileId) {
  const gridfs = getGridFS();
  await gridfs.delete(new mongoose.Types.ObjectId(fileId));
}

module.exports = { uploadScreenshot, deleteScreenshot };
