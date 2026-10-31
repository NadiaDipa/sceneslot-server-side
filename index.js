import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

const app = express();
const PORT = 5000;

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


// 4. Create GET API Route for studios
app.get('/studios', async (req, res) => {
  const result = await studiosCollection.find().toArray();
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