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


/*  New Search API Route */

app.get('/api/search', async (req, res) => {
  try {
    const { tag } = req.query;
    if (!tag) {
      return res.status(400).json({ error: "Tag is required" });
    }

    const db = client.db(DB_NAME);
    const postsCollection = db.collection('posts'); 

    // Search posts by tags (case-insensitive)
    const results = await postsCollection
      .find({ tags: { $regex: tag, $options: "i" } })
      .toArray();

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Search failed", details: err.message });
  }
});

// GET /api/posts?page=1&limit=5&sort=recent/popularity
app.get('/api/posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const sortBy = req.query.sort || 'recent'; // default sort by newest

    const skip = (page - 1) * limit;
    const db = client.db(DB_NAME);
    const postsCollection = db.collection('posts');
    
    let pipeline = [];

    // Add voteDifference for popularity sorting
    if (sortBy === 'popularity') {
      pipeline.push({
        $addFields: {
          voteDifference: { $subtract: ["$upVote", "$downVote"] },
        },
      });
      pipeline.push({ $sort: { voteDifference: -1 } });
    } else {
      // Sort by newest
      pipeline.push({ $sort: { createdAt: -1 } });
    }

    // Pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    const posts = await postsCollection.aggregate(pipeline).toArray();
    const total = await postsCollection.countDocuments();

    // Get comment counts
    const commentsCollection = db.collection('comments');
    const postsWithComments = await Promise.all(
      posts.map(async (post) => {
        const commentCount = await commentsCollection.countDocuments({ postId: post._id });
        return { ...post, commentCount };
      })
    );

    res.json({
      total,
      page,
      pages: Math.ceil(total / limit),
      posts: postsWithComments,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch posts", details: err.message });
  }
});

// Start server after connecting to DB
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server ForumFlow is running on port ${PORT}`);
  });
});
