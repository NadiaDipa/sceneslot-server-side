import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 5000;

// Uploads folder (files users pick from their computer are saved here)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Serve uploaded images at http://localhost:5000/uploads/<filename>
app.use('/uploads', express.static(uploadsDir));

// Multer: only accept real image files, max 5 MB
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `studio-${unique}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// Middlewares
app.use(cors());
app.use(express.json());


// Mongodb
const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectClient = await connectToMongoDB();

const db = connectClient.db("sceneslot-db");
const studiosCollection = db.collection("studios");
const userCollection = db.collection("users");
const bookingCollection = db.collection("bookings");


// Create GET API Route for studios
app.get('/studios', async (req, res) => {
  const result = await studiosCollection.find().toArray();
  res.send(result);
});

// Create GET API Route for studios
app.post('/studios', async (req, res) => {
  const studioData = req.body;
  const result = await studiosCollection.insertOne(studioData);
  res.send(result);
});


// Single Studio Details API
app.get('/studios/:id', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await studiosCollection.findOne(query);
  res.send(result);
});




// Test Route
app.get('/', (req, res) => {
  res.send('SceneSlot server is running!');
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port: ${PORT}`);
});