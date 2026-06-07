const multer = require("multer");
const path = require("path");
const fs = require("fs");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const imageFileFilter = (req, file, cb) => {
  const allowed = /\.(jpg|jpeg|png|webp|gif)$/i;
  if (allowed.test(path.extname(file.originalname))) {
    cb(null, true);
  } else {
    cb(new Error("Only image files (jpg, png, webp, gif) are allowed"), false);
  }
};

// --- Ads: disk storage, files are served as-uploaded ---
const adsDir = path.join(process.cwd(), "uploads", "ads");
ensureDir(adsDir);

const adImage = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, adsDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  }),
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// --- Shop item images: memory storage; post-processed (resize → webp) in the
// controller before being written to disk, so we keep the raw buffer here. ---
const shopItemImage = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = { adImage, shopItemImage };
