
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

// Initialize hardcoded users
async function initializeUsers() {
  try {
    const users = [
      { email: 'paula.minardi2@gmail.com', password: 'lene' },
      { email: 'bbclongo@hotmail.com', password: 'linho' }
    ];

    for (const user of users) {
      const userExists = await db.get(`user:${user.email}`);
      if (!userExists || (userExists.ok === false)) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        await db.set(`user:${user.email}`, { email: user.email, password: hashedPassword });
        console.log(`User created: ${user.email}`);
      } else {
        console.log(`User already exists: ${user.email}`);
      }
    }
  } catch (error) {
    console.error('Error initializing users:', error);
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

app.get('/add', requireAuth, (req, res) => {
  res.send(generateAddNotePage());
});

app.get('/login', (req, res) => {
  res.send(generateLoginPage());
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`Login attempt for email: ${email}`);
    
    const userResult = await db.get(`user:${email}`);
    console.log('Database result:', JSON.stringify(userResult));
    
    // Handle Replit Database result format
    const user = userResult && userResult.ok === true ? userResult.value : null;
    console.log('User found in database:', user ? 'Yes' : 'No');
    
    if (user && user.password) {
      const isPasswordValid = await bcrypt.compare(password, user.password);
      console.log('Password comparison result:', isPasswordValid);
      
      if (isPasswordValid) {
        req.session.user = email;
        console.log('Login successful');
        res.redirect('/');
      } else {
        console.log('Login failed - password mismatch');
        res.send(generateLoginPage('Invalid credentials'));
      }
    } else {
      console.log('Login failed - user not found or no password');
      res.send(generateLoginPage('Invalid credentials'));
    }
  } catch (error) {
    console.error('Login error:', error);
    res.send(generateLoginPage('Login error occurred'));
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
    createdBy: req.session.user
  };
  
  await db.set(`note:${noteId}`, note);
  res.redirect('/');
});

app.get('/search', requireAuth, async (req, res) => {
  const { tag, user } = req.query;
  const notes = await getAllNotes();
  let filteredNotes = notes;
  let searchDescription = '';
  
  if (tag) {
    filteredNotes = filteredNotes.filter(note => 
      note.tags.some(noteTag => noteTag.toLowerCase().includes(tag.toLowerCase()))
    );
    searchDescription = `tag "${tag}"`;
  }
  
  if (user) {
    filteredNotes = filteredNotes.filter(note => 
      note.createdBy && note.createdBy.toLowerCase().includes(user.toLowerCase())
    );
    searchDescription = searchDescription ? `${searchDescription} and user "${user}"` : `user "${user}"`;
  }
  
  res.send(generateHomePage(filteredNotes, '', searchDescription));
});

app.post('/delete-note', requireAuth, async (req, res) => {
  const { noteId } = req.body;
  await db.delete(`note:${noteId}`);
  res.redirect('/');
});



// Helper functions
async function getAllNotes() {
  try {
    const keysResult = await db.list();
    console.log('Keys result:', JSON.stringify(keysResult));
    
    // Handle Replit Database list format
    const keys = Array.isArray(keysResult) ? keysResult : (keysResult && keysResult.value ? keysResult.value : []);
    const noteKeys = keys.filter(key => key.startsWith('note:'));
    const notes = [];
    
    for (const key of noteKeys) {
      const noteResult = await db.get(key);
      const note = noteResult && noteResult.ok === true ? noteResult.value : noteResult;
      if (note) notes.push(note);
    }
    
    return notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.error('Error getting notes:', error);
    return [];
  }
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
            input[type="email"], input[type="password"] { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
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
                <label for="email">Email:</label>
                <input type="email" id="email" name="email" required>
            </div>
            <div class="form-group">
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit">Login</button>
        </form>
        <div class="info">
            <p><strong>Test Accounts:</strong></p>
            <p>paula.minardi2@gmail.com / lene</p>
            <p>bbclongo@hotmail.com / linho</p>
        </div>
    </body>
    </html>
  `;
}

function generateHomePage(notes, searchTag = '', searchDescription = '') {
  const allTags = [...new Set(notes.flatMap(note => note.tags))];
  const allUsers = [...new Set(notes.map(note => note.createdBy || note.user).filter(Boolean))];
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Notes App - Home</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; padding-bottom: 80px; }
            .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
            .search-section { background-color: #e9ecef; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .form-group { margin-bottom: 15px; }
            label { display: block; margin-bottom: 5px; font-weight: bold; }
            input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
            button { background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
            button:hover { background-color: #0056b3; }
            .logout-btn { background-color: #dc3545; }
            .logout-btn:hover { background-color: #c82333; }
            .notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
            .note-card { background-color: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .note-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #333; }
            .note-content { margin-bottom: 15px; color: #666; }
            .note-tags { margin-bottom: 10px; }
            .tag { background-color: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-right: 5px; }
            .user-tag { background-color: #28a745; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; cursor: pointer; }
            .user-tag:hover { background-color: #218838; }
            .note-link { margin-bottom: 10px; }
            .note-link a { color: #007bff; text-decoration: none; }
            .note-link a:hover { text-decoration: underline; }
            .note-meta { font-size: 12px; color: #999; margin-bottom: 10px; }
            .note-creator { font-size: 12px; color: #28a745; margin-bottom: 10px; font-weight: bold; }
            .delete-btn { background-color: #dc3545; font-size: 12px; padding: 5px 10px; }
            .delete-btn:hover { background-color: #c82333; }
            .no-notes { text-align: center; color: #666; margin: 40px 0; }
            .search-row { display: flex; gap: 10px; align-items: end; margin-bottom: 10px; }
            .search-field { flex: 1; }
            
            /* Bottom Navigation */
            .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background-color: white; border-top: 1px solid #ddd; display: flex; }
            .nav-item { flex: 1; text-align: center; padding: 15px 10px; text-decoration: none; color: #666; transition: all 0.3s; }
            .nav-item.active { color: #007bff; background-color: #f8f9fa; }
            .nav-item:hover { background-color: #f8f9fa; }
            .nav-icon { font-size: 20px; display: block; margin-bottom: 5px; }
            .nav-label { font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Home</h1>
                <form method="POST" action="/logout" style="margin: 0;">
                    <button type="submit" class="logout-btn">Logout</button>
                </form>
            </div>

            <div class="search-section">
                <h3>Search Notes</h3>
                <form method="GET" action="/search">
                    <div class="search-row">
                        <div class="search-field">
                            <label for="tag">Tag:</label>
                            <input type="text" id="tag" name="tag" value="${searchTag}" placeholder="Enter tag to search">
                        </div>
                        <div class="search-field">
                            <label for="user">User:</label>
                            <input type="text" id="user" name="user" placeholder="Enter user email to search">
                        </div>
                        <button type="submit">Search</button>
                        <a href="/" style="text-decoration: none;"><button type="button">Clear</button></a>
                    </div>
                </form>
                ${allTags.length > 0 ? `
                    <div style="margin-top: 10px;">
                        <strong>Available tags:</strong> 
                        ${allTags.map(tag => `<a href="/search?tag=${encodeURIComponent(tag)}" style="text-decoration: none;"><span class="tag">${tag}</span></a>`).join(' ')}
                    </div>
                ` : ''}
                ${allUsers.length > 0 ? `
                    <div style="margin-top: 10px;">
                        <strong>Users:</strong> 
                        ${allUsers.map(user => `<a href="/search?user=${encodeURIComponent(user)}" style="text-decoration: none;"><span class="user-tag">${user}</span></a>`).join(' ')}
                    </div>
                ` : ''}
            </div>

            <div>
                <h3>Notes ${searchDescription ? `(filtered by ${searchDescription})` : `(${notes.length} total)`}</h3>
                ${notes.length === 0 ? 
                    `<div class="no-notes">No notes found${searchDescription ? ` for ${searchDescription}` : ''}.</div>` :
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
                                <div class="note-creator">Created by: ${note.createdBy || note.user || 'Unknown'}</div>
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
        </div>

        <!-- Bottom Navigation -->
        <div class="bottom-nav">
            <a href="/" class="nav-item active">
                <span class="nav-icon">🏠</span>
                <span class="nav-label">Home</span>
            </a>
            <a href="/add" class="nav-item">
                <span class="nav-icon">+</span>
                <span class="nav-label">Add Note</span>
            </a>
        </div>
    </body>
    </html>
  `;
}

function generateAddNotePage() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Notes App - Add Note</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; padding-bottom: 80px; }
            .container { max-width: 800px; margin: 0 auto; padding: 20px; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
            .form-section { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
            .form-group { margin-bottom: 15px; }
            label { display: block; margin-bottom: 5px; font-weight: bold; }
            input, textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
            textarea { height: 100px; resize: vertical; }
            button { background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
            button:hover { background-color: #0056b3; }
            .logout-btn { background-color: #dc3545; }
            .logout-btn:hover { background-color: #c82333; }
            .cancel-btn { background-color: #6c757d; }
            .cancel-btn:hover { background-color: #5a6268; }
            
            /* Bottom Navigation */
            .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background-color: white; border-top: 1px solid #ddd; display: flex; }
            .nav-item { flex: 1; text-align: center; padding: 15px 10px; text-decoration: none; color: #666; transition: all 0.3s; }
            .nav-item.active { color: #007bff; background-color: #f8f9fa; }
            .nav-item:hover { background-color: #f8f9fa; }
            .nav-icon { font-size: 20px; display: block; margin-bottom: 5px; }
            .nav-label { font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Add New Note</h1>
                <form method="POST" action="/logout" style="margin: 0;">
                    <button type="submit" class="logout-btn">Logout</button>
                </form>
            </div>

            <div class="form-section">
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
                    <a href="/" style="text-decoration: none;"><button type="button" class="cancel-btn">Cancel</button></a>
                </form>
            </div>
        </div>

        <!-- Bottom Navigation -->
        <div class="bottom-nav">
            <a href="/" class="nav-item">
                <span class="nav-icon">🏠</span>
                <span class="nav-label">Home</span>
            </a>
            <a href="/add" class="nav-item active">
                <span class="nav-icon">+</span>
                <span class="nav-label">Add Note</span>
            </a>
        </div>
    </body>
    </html>
  `;
}

// Start server
initializeUsers().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log('Test accounts:');
    console.log('paula.minardi2@gmail.com / lene');
    console.log('bbclongo@hotmail.com / linho');
  });
});
