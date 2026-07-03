// Run npm install express cors
const express = require('express');
const cors = require('cors');
const app = express();

// Enable CORS so your React frontend can access this API
app.use(cors());

app.get('/api/message', (req, res) => {
  res.json({ text: "Hello from the Node.js backend!" });
});

app.listen(3000, () => {
  console.log('Backend running on http://localhost:3000');
});
