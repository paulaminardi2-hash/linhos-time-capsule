
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const Database = require('@replit/database');

const app = express();
const db = new Database();
const PORT = 5000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Initialize default user (username: admin, password: admin)
async function initializeUser() {
  const userExists = await db.get('user:admin');
  if (!userExists) {
    const hashedPassword = await bcrypt.hash('admin', 10);
    await db.set('user:admin', { username: 'admin', password: hashedPassword });
    console.log('Default user created: admin/admin');
  }
}

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Routes
app.get('/', requireAuth, async (req, res) => {
  const notes = await getAllNotes();
  res.send(generateHomePage(notes));
});

app.get('/login', (req, res) => {
  res.send(generateLoginPage());
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get(`user:${username}`);
  
  if (user && await bcrypt.compare(password, user.password)) {
    req.session.user = username;
    res.redirect('/');
  } else {
    res.send(generateLoginPage('Invalid credentials'));
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.post('/add-note', requireAuth, async (req, res) => {
  const { title, content, tags, link } = req.body;
  const noteId = Date.now().toString();
  
  const note = {
    id: noteId,
    title,
    content,
    tags: tags.split(',').map(tag => tag.trim()).filter(tag => tag),
    link: link || '',
    createdAt: new Date().toISOString(),
    user: req.session.user
  };
  
  await db.set(`note:${noteId}`, note);
  res.redirect('/');
});

app.get('/search', requireAuth, async (req, res) => {
  const { tag } = req.query;
  const notes = await getAllNotes();
  const filteredNotes = notes.filter(note => 
    note.tags.some(noteTag => noteTag.toLowerCase().includes(tag.toLowerCase()))
  );
  res.send(generateHomePage(filteredNotes, tag));
});

app.post('/delete-note', requireAuth, async (req, res) => {
  const { noteId } = req.body;
  await db.delete(`note:${noteId}`);
  res.redirect('/');
});

// Helper functions
async function getAllNotes() {
  const keys = await db.list();
  const noteKeys = keys.filter(key => key.startsWith('note:'));
  const notes = [];
  
  for (const key of noteKeys) {
    const note = await db.get(key);
    if (note) notes.push(note);
  }
  
  return notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function generateLoginPage(error = '') {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Login - Notes App</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
            .form-group { margin-bottom: 15px; }
            label { display: block; margin-bottom: 5px; font-weight: bold; }
            input[type="text"], input[type="password"] { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
            button { background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%; }
            button:hover { background-color: #0056b3; }
            .error { color: red; margin-bottom: 15px; }
            .info { color: #666; margin-top: 15px; font-size: 14px; }
        </style>
    </head>
    <body>
        <h2>Login to Notes App</h2>
        ${error ? `<div class="error">${error}</div>` : ''}
        <form method="POST" action="/login">
            <div class="form-group">
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div class="form-group">
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit">Login</button>
        </form>
        <div class="info">Default credentials: admin / admin</div>
    </body>
    </html>
  `;
}

function generateHomePage(notes, searchTag = '') {
  const allTags = [...new Set(notes.flatMap(note => note.tags))];
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Notes App</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
            .form-section { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
            .form-group { margin-bottom: 15px; }
            label { display: block; margin-bottom: 5px; font-weight: bold; }
            input, textarea, select { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
            textarea { height: 100px; resize: vertical; }
            button { background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
            button:hover { background-color: #0056b3; }
            .logout-btn { background-color: #dc3545; }
            .logout-btn:hover { background-color: #c82333; }
            .search-section { background-color: #e9ecef; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
            .note-card { background-color: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .note-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #333; }
            .note-content { margin-bottom: 15px; color: #666; }
            .note-tags { margin-bottom: 10px; }
            .tag { background-color: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-right: 5px; }
            .note-link { margin-bottom: 10px; }
            .note-link a { color: #007bff; text-decoration: none; }
            .note-link a:hover { text-decoration: underline; }
            .note-meta { font-size: 12px; color: #999; margin-bottom: 10px; }
            .delete-btn { background-color: #dc3545; font-size: 12px; padding: 5px 10px; }
            .delete-btn:hover { background-color: #c82333; }
            .no-notes { text-align: center; color: #666; margin: 40px 0; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>My Notes</h1>
            <form method="POST" action="/logout" style="margin: 0;">
                <button type="submit" class="logout-btn">Logout</button>
            </form>
        </div>

        <div class="form-section">
            <h3>Add New Note</h3>
            <form method="POST" action="/add-note">
                <div class="form-group">
                    <label for="title">Title:</label>
                    <input type="text" id="title" name="title" required>
                </div>
                <div class="form-group">
                    <label for="content">Content:</label>
                    <textarea id="content" name="content" required></textarea>
                </div>
                <div class="form-group">
                    <label for="tags">Tags (comma-separated):</label>
                    <input type="text" id="tags" name="tags" placeholder="work, personal, important">
                </div>
                <div class="form-group">
                    <label for="link">Link (optional):</label>
                    <input type="url" id="link" name="link" placeholder="https://example.com">
                </div>
                <button type="submit">Add Note</button>
            </form>
        </div>

        <div class="search-section">
            <h3>Search by Tag</h3>
            <form method="GET" action="/search" style="display: flex; gap: 10px; align-items: end;">
                <div style="flex: 1;">
                    <label for="tag">Tag:</label>
                    <input type="text" id="tag" name="tag" value="${searchTag}" placeholder="Enter tag to search">
                </div>
                <button type="submit">Search</button>
                <a href="/" style="text-decoration: none;"><button type="button">Clear</button></a>
            </form>
            ${allTags.length > 0 ? `
                <div style="margin-top: 10px;">
                    <strong>Available tags:</strong> 
                    ${allTags.map(tag => `<a href="/search?tag=${encodeURIComponent(tag)}" style="text-decoration: none;"><span class="tag">${tag}</span></a>`).join(' ')}
                </div>
            ` : ''}
        </div>

        <div>
            <h3>Notes ${searchTag ? `(filtered by "${searchTag}")` : `(${notes.length} total)`}</h3>
            ${notes.length === 0 ? 
                `<div class="no-notes">No notes found${searchTag ? ` for tag "${searchTag}"` : ''}.</div>` :
                `<div class="notes-grid">
                    ${notes.map(note => `
                        <div class="note-card">
                            <div class="note-title">${note.title}</div>
                            <div class="note-content">${note.content}</div>
                            ${note.tags.length > 0 ? `
                                <div class="note-tags">
                                    ${note.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                                </div>
                            ` : ''}
                            ${note.link ? `
                                <div class="note-link">
                                    <a href="${note.link}" target="_blank">🔗 ${note.link}</a>
                                </div>
                            ` : ''}
                            <div class="note-meta">Created: ${new Date(note.createdAt).toLocaleString()}</div>
                            <form method="POST" action="/delete-note" style="margin: 0;">
                                <input type="hidden" name="noteId" value="${note.id}">
                                <button type="submit" class="delete-btn" onclick="return confirm('Are you sure you want to delete this note?')">Delete</button>
                            </form>
                        </div>
                    `).join('')}
                </div>`
            }
        </div>
    </body>
    </html>
  `;
}

// Start server
initializeUser().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log('Default login: admin / admin');
  });
});
