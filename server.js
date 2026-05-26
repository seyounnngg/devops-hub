const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});

app.get('/auth/github', (req, res) => {
  const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=user`;
  res.redirect(url);
});

app.get('/auth/github/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code
    }, {
      headers: { accept: 'application/json' }
    });

    const accessToken = tokenResponse.data.access_token;
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${accessToken}` }
    });

    const { id: github_id, login: username, avatar_url } = userResponse.data;

    const [rows] = await pool.execute('SELECT * FROM users WHERE github_id = ?', [github_id]);
    let user = rows[0];

    if (!user) {
      await pool.execute(
        'INSERT INTO users (github_id, username, avatar_url) VALUES (?, ?, ?)',
        [github_id, username, avatar_url]
      );
      const [newRows] = await pool.execute('SELECT * FROM users WHERE github_id = ?', [github_id]);
      user = newRows[0];
    }

    const sessionToken = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token: sessionToken, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.sendStatus(404);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/projects', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM projects WHERE user_id = ?', [req.user.id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/projects', authenticateToken, async (req, res) => {
  const { name, repository, branch, framework_type, service_type } = req.body;
  try {
    await pool.execute(
      'INSERT INTO projects (user_id, name, repository, branch, framework_type, service_type) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, name, repository, branch || 'main', framework_type, service_type]
    );
    res.status(201).json({ message: "success" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/projects/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.execute('DELETE FROM projects WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: "deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/repositories', authenticateToken, (req, res) => {
  res.json([
    { id: 1, name: "sample-react-app", url: "https://github.com/user/sample-react-app" },
    { id: 2, name: "company-landing-page", url: "https://github.com/user/company-landing-page" }
  ]);
});

app.get('/repositories/:id/branches', authenticateToken, (req, res) => {
  res.json([
    { name: "main" },
    { name: "develop" },
    { name: "feature/ui" }
  ]);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
