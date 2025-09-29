require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB setup
const { DB_USER, DB_PASS, DB_NAME, DB_CLUSTER } = process.env;
const uri = `mongodb+srv://${DB_USER}:${DB_PASS}@${DB_CLUSTER}/${DB_NAME}?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Connect to MongoDB
async function connectDB() {
  try {
    await client.connect();
    console.log(' Connected to MongoDB successfully!');
  } catch (err) {
    console.error(' MongoDB connection error:', err);
    process.exit(1);
  }
}

// Simple route
app.get('/', (req, res) => {
  res.send('Hello from ForumFlow!');
});

// Example API route
app.get('/api/test', async (req, res) => {
  try {
    const db = client.db(DB_NAME);
    const testData = await db.collection('users').find().toArray(); // example collection
    res.json({ message: 'This is a test API route', data: testData });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data', details: err.message });
  }
});

// Start server after connecting to DB
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server ForumFlow is running on port ${PORT}`);
  });
});
