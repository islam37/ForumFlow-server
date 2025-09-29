
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors());

app.use(express.json());

// Simple route
app.get('/', (req, res) => {
    res.send('Hello from ForumFlow!');
});

// Example API route
app.get('/api/test', (req, res) => {
    res.json({ message: 'This is a test API route' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server ForumFlow is running on ${PORT}`);
});
