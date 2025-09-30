require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

///-----firebase admin----------------



const admin = require("firebase-admin");

const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});



//-------------

// const admin = require("firebase-admin");

// // Initialize Firebase Admin
// const serviceAccount = require("./adminSdk.json");
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });



// -----hello...........

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------- MIDDLEWARE SETUP -------------------
app.use(cors());
app.use(express.json());

// MongoDB setup
const { DB_USER, DB_PASS, DB_NAME, DB_CLUSTER } = process.env;
const uri = `mongodb+srv://${DB_USER}:${DB_PASS}@${DB_CLUSTER}/${DB_NAME}?retryWrites=true&w=majority&appName=ForumFlow`;
const client = new MongoClient(uri, {
  serverApi: { 
    version: ServerApiVersion.v1, 
    strict: true, 
    deprecationErrors: true 
  }
});

// Connect to MongoDB
async function connectDB() {
  try {
    await client.connect();
    await client.db(DB_NAME).command({ ping: 1 });
    app.locals.dbClient = client;
    console.log(' Connected to MongoDB successfully!');
  } catch (err) {
    console.error(' MongoDB connection error:', err);
    process.exit(1);
  }
}

// ------------------- MIDDLEWARES -------------------

// Verify Firebase Token
async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized - No token provided" });
  }
  const idToken = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    
    // insert/update user in MongoDB
    const db = req.app.locals.dbClient.db(DB_NAME);
    const usersCollection = db.collection("users");
    
    await usersCollection.updateOne(
      { uid: decodedToken.uid },
      { 
        $set: { 
          email: decodedToken.email, 
          name: decodedToken.name || decodedToken.email.split('@')[0],
          lastLogin: new Date()
        },
        $setOnInsert: { 
          uid: decodedToken.uid,
          role: "user",
          createdAt: new Date()
        } 
      },
      { upsert: true }
    );
    
    next();
  } catch (err) {
    return res.status(403).json({ error: "Forbidden", details: "Invalid token" });
  }
}

// Verify Admin Role
async function verifyAdmin(req, res, next) {
  try {
    const db = req.app.locals.dbClient.db(DB_NAME);
    const user = await db.collection("users").findOne({ uid: req.user.uid });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access only" });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}

// ------------------- ROUTES -------------------

// Root
app.get('/', (req, res) => {
  res.json({ message: 'Hello from ForumFlow API!' });
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    res.json({ 
      status: 'OK', 
      database: 'Connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'Error', database: 'Disconnected' });
  }
});

// Get current user
app.get('/api/me', verifyFirebaseToken, async (req, res) => {
  try {
    const db = req.app.locals.dbClient.db(DB_NAME);
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ uid: req.user.uid });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      uid: user.uid,
      email: user.email,
      name: user.name,
      role: user.role,
      lastLogin: user.lastLogin
    });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// ------------------- POSTS ROUTES -------------------

// Get all posts with filtering and pagination
app.get("/api/posts", async (req, res) => {
  try {
    const { email, tag, page = 1, limit = 5, sort = "recent" } = req.query;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    let filter = {};
    if (email) filter.authorEmail = email;
    if (tag) filter.tag = tag;

    const sortOption = sort === "popularity" ? { upVote: -1 } : { createdAt: -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await postsCollection
      .find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const total = await postsCollection.countDocuments(filter);
    const pages = Math.ceil(total / limit);

    res.json({ posts, pages, total });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Get single post by ID
app.get("/api/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const post = await postsCollection.findOne({ _id: new ObjectId(id) });
    
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Create a new post
app.post("/api/posts", async (req, res) => {
  try {
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const { authorImage, authorName, authorEmail, postTitle, postDescription, tag } = req.body;

    if (!postTitle || !postDescription) {
      return res.status(400).json({ error: "Title and description are required" });
    }

    const newPost = {
      authorImage,
      authorName,
      authorEmail,
      postTitle,
      postDescription,
      tag,
      upVote: 0,
      downVote: 0,
      comments: [],
      createdAt: new Date(),
    };

    const result = await postsCollection.insertOne(newPost);
    res.status(201).json({ message: "Post created", postId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Vote on a post
app.put("/api/posts/vote/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const updateField = type === "upvote" ? { $inc: { upVote: 1 } } : { $inc: { downVote: 1 } };
    
    const result = await postsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      updateField,
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Add comment to post
app.post("/api/posts/comment/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { comment, userId } = req.body;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: "Comment is required" });
    }

    const newComment = {
      text: comment.trim(),
      authorName: "User", // You might want to get this from user data
      authorId: userId,
      createdAt: new Date()
    };

    const result = await postsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $push: { comments: newComment } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Get post count by user email
app.get("/api/posts/count", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email query param required" });
    }

    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const count = await postsCollection.countDocuments({ authorEmail: email });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Delete post
app.delete("/api/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const result = await postsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ message: "Post deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Update a post
app.put("/api/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { postTitle, postDescription, tag, authorImage } = req.body;

    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const result = await postsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { postTitle, postDescription, tag, authorImage, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ message: "Post updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Get user dashboard stats
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email required" });

    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const totalPosts = await postsCollection.countDocuments({ authorEmail: email });
    const publishedPosts = await postsCollection.countDocuments({ authorEmail: email, status: "published" });
    const draftPosts = await postsCollection.countDocuments({ authorEmail: email, status: "draft" });

    res.json({ totalPosts, publishedPosts, draftPosts });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});


// ------------------- TAGS ROUTES -------------------

// Get all unique tags
app.get("/api/tags", async (req, res) => {
  try {
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const tags = await postsCollection.distinct("tag", { tag: { $exists: true, $ne: "" } });
    
    res.json(tags.filter(tag => tag)); // Filter out empty/null tags
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Get posts by tag
app.get("/api/tags/:tag", async (req, res) => {
  try {
    const { tag } = req.params;
    const { page = 1, limit = 5 } = req.query;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await postsCollection
      .find({ tag: tag })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const total = await postsCollection.countDocuments({ tag: tag });
    const pages = Math.ceil(total / limit);

    res.json({ posts, pages, total });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});
// tags
app.get("/api/tags", async (req, res) => {
  try {
    const db = req.app.locals.dbClient.db(DB_NAME);
    const postsCollection = db.collection("posts");

    const tags = await postsCollection.distinct("tag", { tag: { $exists: true, $ne: "" } });
    
    res.json(tags.filter(tag => tag)); // Filter out empty/null tags
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});



// ----------- admin--------------

// GET all users (admin only)
app.get("/api/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const db = req.app.locals.dbClient.db(DB_NAME);
    const users = await db.collection("users").find().toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users", details: err.message });
  }
});

// Make a user admin (admin only)
app.patch("/api/users/make-admin/:uid", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const result = await db.collection("users").updateOne(
      { uid },
      { $set: { role: "admin" } }
    );
    res.json({ message: "User promoted to admin", result });
  } catch (err) {
    res.status(500).json({ error: "Failed to update user", details: err.message });
  }
});

// Update membership (admin only)
app.patch("/api/users/membership/:uid", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { membership } = req.body;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const result = await db.collection("users").updateOne(
      { uid },
      { $set: { membership } }
    );
    res.json({ message: "Membership updated", result });
  } catch (err) {
    res.status(500).json({ error: "Failed to update membership", details: err.message });
  }
});



// ------------------- ANNOUNCEMENTS ROUTES -------------------

// Get all announcements
app.get("/api/announcements", async (req, res) => {
  try {
    const db = req.app.locals.dbClient.db(DB_NAME);
    const announcementsCollection = db.collection("announcements");

    const announcements = await announcementsCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Create new announcement (admin only)
app.post("/api/announcements", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { authorName, authorImage, title, description } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: "Title and Description are required" });
    }

    const db = req.app.locals.dbClient.db(DB_NAME);
    const announcementsCollection = db.collection("announcements");

    const newAnnouncement = {
      authorName,
      authorImage,
      title,
      description,
      createdAt: new Date()
    };

    const result = await announcementsCollection.insertOne(newAnnouncement);

    res.status(201).json({ message: "Announcement posted successfully", id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Delete announcement (admin only)
app.delete("/api/announcements/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = req.app.locals.dbClient.db(DB_NAME);
    const announcementsCollection = db.collection("announcements");

    const result = await announcementsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Announcement not found" });
    }

    res.json({ message: "Announcement deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});



// Create a new report
app.post("/api/reports", verifyFirebaseToken, async (req, res) => {
  try {
    const { reportedUserUid, reportedUserEmail, contentId, contentSnippet, reason } = req.body;

    if (!reportedUserUid || !reportedUserEmail || !contentId || !reason) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const db = req.app.locals.dbClient.db(DB_NAME);
    const reportsCollection = db.collection("reports");

    const newReport = {
      reporterUid: req.user.uid,
      reporterEmail: req.user.email,
      reportedUserUid,
      reportedUserEmail,
      contentId,
      contentSnippet: contentSnippet || "",
      reason,
      status: "pending",
      createdAt: new Date(),
      actions: []
    };

    const result = await reportsCollection.insertOne(newReport);
    res.status(201).json({ message: "Report submitted successfully", reportId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Get all reports
app.get("/api/reports", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const db = req.app.locals.dbClient.db(DB_NAME);
    const reportsCollection = db.collection("reports");

    const reports = await reportsCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reports", details: err.message });
  }
});
// Update report status or take action
app.patch("/api/reports/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // e.g. "warn", "delete", "ban", "resolve"

    const db = req.app.locals.dbClient.db(DB_NAME);
    const reportsCollection = db.collection("reports");

    const validActions = ["warn", "delete", "ban", "resolve"];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const update = {
      $set: { status: action === "resolve" ? "resolved" : "action_taken" },
      $push: { actions: { type: action, at: new Date() } }
    };

    const result = await reportsCollection.updateOne(
      { _id: new ObjectId(id) },
      update
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Report not found" });
    }

    res.json({ message: `Action '${action}' applied successfully` });
  } catch (err) {
    res.status(500).json({ error: "Failed to update report", details: err.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    details: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await client.close();
  process.exit(0);
});

// Start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(` Server running on port ${PORT}`);
  
  });
}).catch(() => process.exit(1));