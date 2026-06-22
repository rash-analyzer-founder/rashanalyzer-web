const express = require('express');
const app = express();
const PORT = 3000;

// This handles the main route of your website
app.get('/', (req, res) => {
    res.send('Hello World! Your backend is officially alive!');
});

// This starts the server and listens for requests
app.listen(PORT, () => {
    console.log(`Server is running smoothly on http://localhost:${PORT}`);
});
