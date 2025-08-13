
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const Database = require('@replit/database');

// Make sure we use the Render env var explicitly
const db = new Database(process.env.REPLIT_DB_URL);

if (!process.env.REPLIT_DB_URL) {
  console.error('❌ Missing REPLIT_DB_URL env var. Set it in Render > Environment.');
}

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
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
  const allTags = [...new Set(notes.flatMap(note => note.tags))];
  res.send(generateHomePage(notes, '', '', 'home', allTags));
  });

app.get('/home', requireAuth, async (req, res) => {
  const notes = await getAllNotes();
  const allTags = [...new Set(notes.flatMap(note => note.tags))];
  res.send(generateHomePage(notes, '', '', 'home', allTags));
});

app.get('/notes', async (req, res) => {
  const notes = await getAllNotes(); 
  const allTags = [...new Set(notes.flatMap(note => note.tags))];
  res.send(generateNotesPage(notes, '', '', 'notes', allTags));
  const html = generateNotesPage(notes, '', '', 'notes');
});

app.get('/add', requireAuth, async (req, res) => {
    const notes = await getAllNotes();
      const allTags = [...new Set(notes.flatMap(note => note.tags))];
      res.send(generateAddNotePage(allTags));
    });

app.get('/login', (req, res) => {
  res.send(generateLoginPage());
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`Login attempt for email: ${email}`);

    // Handle both shapes: wrapped { ok, value } OR direct object/null
    const userRaw = await db.get(`user:${email}`);
    const user = userRaw && userRaw.ok === true ? userRaw.value : userRaw;

    console.log('Raw DB get:', JSON.stringify(userRaw));
    console.log('Parsed user object?', !!user);

    if (user && user.password) {
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (isPasswordValid) {
        req.session.user = email;
        return res.redirect('/');
      }
    }

    // fallthrough -> invalid
    return res.send(generateLoginPage('Invalid credentials'));
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
    createdBy: req.session.user,
    comments: []
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
  
   res.send(generateHomePage(
      filteredNotes,
      tag || '',
      searchDescription,
      'home',
      [...new Set(filteredNotes.flatMap(n => n.tags))]
    ));
  });

app.post('/delete-note', requireAuth, async (req, res) => {
  const { noteId } = req.body;
  await db.delete(`note:${noteId}`);
  res.redirect('/');
});

app.post('/notes/:id/comments', requireAuth, async (req, res) => {
  const noteId = req.params.id;
  const { text } = req.body;
  const userEmail = req.session.user || 'unknown@user';
  const author = userEmail.split('@')[0];   // simple username like “paula.minardi2”

  if (!text || !text.trim()) {
    // If the request expects JSON, respond JSON; otherwise redirect.
    if ((req.headers.accept || '').includes('application/json')) {
      return res.status(400).json({ ok: false, error: 'Empty comment' });
    }
    return res.redirect('/');
  }

  // load, mutate, save
  const noteKey = `note:${noteId}`;
  const existing = await db.get(noteKey);
  const note = existing && existing.ok === true ? existing.value : existing;

  if (!note) {
    if ((req.headers.accept || '').includes('application/json')) {
      return res.status(404).json({ ok: false, error: 'Note not found' });
    }
    return res.redirect('/');
  }

  note.comments = Array.isArray(note.comments) ? note.comments : [];

  const comment = {
    id: Date.now().toString(),
    author,
    text,
    createdAt: new Date().toISOString()
  };

  note.comments.push(comment);
  await db.set(noteKey, note);

  // JSON for fetch; redirect for non-AJAX (we’ll use JSON)
  if ((req.headers.accept || '').includes('application/json')) {
    return res.json({ ok: true, comment });
  }
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
    <title>Login – Linho's Time Capsule</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="manifest" href="/manifest.webmanifest">
    <meta name="theme-color" content="#001f3f">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <style>
      :root {
        --navy: #001f3f;
        --card: #012b52;
        --text: #ffffff;
        --muted: #cfd8e3;
        --accent: #ffcc70;
        --input: #163f5f;
        --shadow: rgba(0,0,0,0.25);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background: linear-gradient(160deg, var(--navy) 0%, #013260 60%, #023e73 100%);
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 420px;
        background: var(--card);
        border-radius: 16px;
        padding: 28px;
        box-shadow: 0 8px 24px var(--shadow);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      .brand img { height: 32px; width: 32px; }
      h1 {
        margin: 0;
        font-size: 20px;
        letter-spacing: .3px;
      }
      .subtitle {
        color: var(--muted);
        margin: 6px 0 20px;
        font-size: 14px;
      }
      .error {
        background: rgba(255, 99, 99, .14);
        border: 1px solid rgba(255, 99, 99, .35);
        color: #ffb3b3;
        padding: 10px 12px;
        border-radius: 10px;
        margin-bottom: 12px;
        font-size: 14px;
      }
      .group { margin-bottom: 12px; }
      label {
        display: block;
        font-weight: 600;
        margin-bottom: 6px;
        font-size: 14px;
        color: #e6eef7;
      }
      input[type="email"], input[type="password"] {
        width: 100%;
        padding: 12px 14px;
        border: none;
        outline: none;
        border-radius: 12px;
        background: var(--input);
        color: var(--text);
        font-size: 15px;
      }
      .btn {
        width: 100%;
        margin-top: 14px;
        background: var(--accent);
        color: #001f3f;
        border: none;
        border-radius: 12px;
        padding: 12px 16px;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 4px 10px var(--shadow);
      }
      .footer {
        margin-top: 18px;
        font-size: 12px;
        color: var(--muted);
        text-align: center;
      }
      .test-accounts {
        margin-top: 12px;
        padding: 10px 12px;
        background: rgba(255,255,255,0.06);
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.4;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="brand">
        <img src="/logo.png" alt="Logo">
        <h1>Linho's Time Capsule</h1>
      </div>
      <div class="subtitle">Sign in to continue</div>
      ${error ? `<div class="error">${error}</div>` : ''}

      <form method="POST" action="/login">
        <div class="group">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required autocomplete="username">
        </div>
        <div class="group">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" required autocomplete="current-password">
        </div>
        <button class="btn" type="submit">Log in</button>
      </form>

      <div class="test-accounts">
        <strong>Test Accounts</strong><br>
        paula.minardi2@gmail.com / lene<br>
        bbclongo@hotmail.com / linho
      </div>

      <div class="footer">© ${new Date().getFullYear()} Linho</div>
    </div>

    <script>
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(()=>{});
      }
    </script>
  </body>
  </html>
  `;
}


function generateHomePage(notes, searchTag = '', searchDescription = '',  activePage = '', allTags = []) {

  return `<!DOCTYPE html>
<html>
<head>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#001f3f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
  <title>Time Capsule</title>
  <style>
    body {
      margin: 0;
      background-color: #001f3f;
      color: white;
      overflow-x: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .top-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      background-color: #001f3f;
    }
   .nav-links {
     display: flex;
     gap: 8px;
     align-items: center;
   }
    .nav-left {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .nav-right {
      display: flex;
      align-items: center;
    }
    .logo {
      height: 28px;
    }
    .logout-icon {
      height: 50px;
      width: 70px;
      margin-left: 12px;
      opacity: 0.9;
    }
    .nav-text {
      font-size: 15px;
      font-weight: 500;
      color: #ffffffcc; /* softer white */
      text-decoration: none;
      margin-left: 16px;
      transition: color 0.2s;
    }
    .nav-text.active {
      color: white;
      text-decoration: underline;
    }
    .nav-text:hover {
      color: white;
    }
    .container {
      padding-left: 20px;
      padding-right: 20px; /* match left side */
    }
    .search-bar {
      width: 100%;
      padding: 12px 16px;
      border-radius: 999px;
      border: none;
      font-size: 1em;
      margin-bottom: 16px;
      background-color: #ffffff10; /* translucent white */
      color: white;
    }
    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 10px 0 20px 0;
    }
    .tag-button {
      padding: 6px 14px;
      border-radius: 999px;
      background-color: rgba(255, 255, 255, 0.1);
      color: white;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid rgba(255, 255, 255, 0.2);
      transition: background 0.2s ease;
    }
    .tag-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
    }
    .note-container {
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      gap: 16px;
      min-height: 70vh;
      padding: 32px 0;
    }
     .note-card {
       background-color: #012b52;
       color: #fff;
       width: 200px;
       min-width: 200px;
       max-width: 200px;
       border-radius: 16px;
       padding: 56px 24px 24px 24px; /* gives space for tag container */
       display: flex;
       flex-direction: column;
       justify-content: flex-start;
       height: 320px;
       box-shadow: 0 4px 8px rgba(0,0,0,0.2);
       position: relative;
       box-sizing: border-box;
     }
    .tag-badge {
     flex-shrink: 0;
      background-color: #446d76; /* soft blue */
      color: #f5faff;
      font-weight: 600;
      font-size: 0.8em;
      padding: 6px 12px;
      border-radius: 6px;
      white-space: nowrap;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      text-align: center;
    }
      
    .note-date {
      font-size: 0.75em;
      color: #ccc;
      margin-bottom: 20px;
      margin-top: 8px;
    }
    .note-summary {
     text-align: left;
     font-size: 1em;
     color: #e0e0e0;
     font-weight: 400;
     line-height: 1.5em;
     flex-grow: 1;
     display: flex;
     align-items: center;
    }
    .tag-container {
      position: absolute;
      top: 8px;
      left: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: none;
    }

    .expanded-card {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      justify-content: center;
      align-items: center;
      z-index: 999;
    }
    .expanded-content {
      background-color: #012b52;
      color: white;
      border-radius: 16px;
      padding: 24px;
      max-width: 600px;
      width: 90%;
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      position: relative;
    }
    .expanded-content h3 {
      margin-top: 0;
    }
    .expanded-section {
      margin-bottom: 16px;
    }
    .close-expanded {
      position: absolute;
      top: 12px;
      right: 16px;
      font-size: 20px;
      font-weight: bold;
      color: white;
      cursor: pointer;
    }
    .expanded-link a {
    color: #ffcc70;
    word-break: break-word;
    text-decoration: underline;
    }

    /* comment styles */
      .comments-thread { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
      .comment-row { background: rgba(255,255,255,0.06); padding: 10px 12px; border-radius: 10px; }
      .comment-meta { font-size: 12px; color: #ccd; margin-bottom: 4px; display: flex; gap: 8px; }
      .comment-author { font-weight: 600; color: #ffcc70; }
      .comment-text { white-space: pre-wrap; word-break: break-word; }
      .comment-form { display: flex; gap: 8px; margin-top: 12px; }
      .comment-input { flex: 1; padding: 10px 12px; border-radius: 10px; border: none; background: #163f5f; color: white; }
      .comment-btn { background: #ffcc70; color: #001f3f; font-weight: 700; padding: 10px 14px; border: none; border-radius: 10px; cursor: pointer; }
    </style>

    
  </style>
</head>
<body>
  <div class="top-nav">
    <div class="nav-left">
      <img src="/logo.png" alt="Logo" class="logo">
      <a href="/home" class="nav-text ${activePage === 'home' ? 'active' : ''}">Home</a>
      <a href="/notes" class="nav-text ${activePage === 'notes' ? 'active' : ''}">Notes</a>
    </div>
    <div class="nav-right">
      <form method="POST" action="/logout" style="margin: 0;">
        <button type="submit" style="background: none; border: none; cursor: pointer;">
          <img src="/logout-icon.png" alt="Logout" class="logout-icon">
        </button>
      </form>
    </div>
  </div>
  <div class="container">
    <input type="text" class="search-bar" id="searchInput" placeholder="Search by tag or keyword…" value="${searchTag}"/>
    <div class="tag-list">
      ${[...new Set(notes.flatMap(n => n.tags))].map(tag => `<button class="tag-button" onclick="selectTag('${tag}')">${tag}</button>`).join('')}
    </div>

    <div class="note-container" id="noteContainer">
      ${notes.map(renderNoteCard).join('')}
    </div>
  </div>
 <script>
   const searchInput = document.getElementById('searchInput');
   const noteContainer = document.getElementById('noteContainer');

   // Parse comma-separated tokens from the input
   function getTokens() {
     return searchInput.value
       .split(',')
       .map(t => t.trim().toLowerCase())
       .filter(Boolean);
   }

   // Toggle a tag in the input without reloading the page
   function selectTag(tag) {
     const current = searchInput.value;
     const parts = current
       .split(',')
       .map(t => t.trim())
       .filter(Boolean);

     const i = parts.indexOf(tag);
     if (i === -1) parts.push(tag);      // add tag
     else parts.splice(i, 1);            // remove tag

     // Keep a nice "tag, tag, " format while typing more
     searchInput.value = parts.length ? parts.join(', ') + ', ' : '';
     triggerSearch();
   }

   // Show/hide only the note cards (ignore expanded modals)
   function triggerSearch() {
     // Close any open expanded modals while filtering
     document.querySelectorAll('.expanded-card').forEach(m => (m.style.display = 'none'));

     const tokens = getTokens();
     const cards = Array.from(noteContainer.querySelectorAll('.note-card'));

     if (tokens.length === 0) {
       // Reset: show all cards and scroll to start
       cards.forEach(c => (c.style.display = 'block'));
       noteContainer.scrollLeft = 0;
       return;
     }

     cards.forEach(card => {
       const text = card.innerText.toLowerCase();
       const matchesAny = tokens.some(t => text.includes(t));
       card.style.display = matchesAny ? 'block' : 'none';
     });
   }

   // Live filter when user types/edits the search box
   searchInput.addEventListener('input', triggerSearch);

   // Keep expand/close helpers
   function expandNote(id) {
     const modal = document.getElementById('expanded-' + id);
     if (modal) modal.style.display = 'flex';
   }
   function closeNote(id) {
     const modal = document.getElementById('expanded-' + id);
     if (modal) modal.style.display = 'none';
   }
   function submitComment(noteId, formEl) {
      var input = formEl.elements['text'];
      var text = (input.value || '').trim();
      if (!text) return false;

      fetch('/notes/' + noteId + '/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ text: text })
      })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if (!data || !data.ok) return;

        // Append to thread safely using textContent (avoids HTML injection)
        var thread = document.getElementById('comments-' + noteId);
        if (!thread) return;

        var row = document.createElement('div');
        row.className = 'comment-row';

        var meta = document.createElement('div');
        meta.className = 'comment-meta';
        var author = document.createElement('span');
        author.className = 'comment-author';
        author.textContent = '@' + (data.comment.author || 'user');
        var date = document.createElement('span');
        date.className = 'comment-date';
        date.textContent = new Date(data.comment.createdAt).toLocaleString();
        meta.appendChild(author);
        meta.appendChild(date);

        var textDiv = document.createElement('div');
        textDiv.className = 'comment-text';
        textDiv.textContent = data.comment.text || '';

        row.appendChild(meta);
        row.appendChild(textDiv);
        thread.appendChild(row);

        input.value = '';
      })
      .catch(function(){ /* ignore or toast */ });

      // Prevent form navigation
      return false;
    }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }
</script>


</body>
</html>

`;
  
}

function generateNotesPage(notes, searchTag = '', searchDescription = '', activePage = '', allTags = []) {
  return `<!DOCTYPE html>
<html>
<head>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#001f3f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
  <title>Time Capsule</title>
  <style>
    body {
      margin: 0;
      background-color: #001f3f;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .top-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      background-color: #001f3f;
    }
    .nav-left {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .nav-right {
      display: flex;
      align-items: center;
    }
    .logo {
      height: 28px;
    }
    .nav-text {
      font-size: 15px;
      font-weight: 500;
      color: #ffffffcc;
      text-decoration: none;
      margin-left: 16px;
      transition: color 0.2s;
    }
    .nav-text.active {
      color: white;
      text-decoration: underline;
    }
    .nav-text:hover {
      color: white;
    }
    .logout-icon {
      height: 50px;
      width: 70px;
      margin-left: 12px;
      opacity: 0.8;
    }
    .note-container {
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      gap: 16px;
      min-height: 70vh;
      padding: 32px 0;
    }
     .note-card {
       background-color: #012b52;
       color: #fff;
       width: 200px;
       min-width: 200px;
       max-width: 200px;
       border-radius: 16px;
       padding: 56px 24px 24px 24px; /* gives space for tag container */
       display: flex;
       flex-direction: column;
       justify-content: flex-start;
       height: 320px;
       box-shadow: 0 4px 8px rgba(0,0,0,0.2);
       position: relative;
       box-sizing: border-box;
     }
     
    /* On larger screens, allow 2 or 3 cards per row */
    @media (min-width: 600px) {
      .note-card {
        flex: 1 1 calc(50% - 24px);
        max-width: calc(50% - 24px);
      }
    }

    @media (min-width: 900px) {
      .note-card {
        flex: 1 1 calc(33.333% - 24px);
        max-width: calc(33.333% - 24px);
      }
    }

   .tag-badge {
     flex-shrink: 0;
     top: 8px;
     left: 16px;
     background-color: #446d76;
     color: #f5faff;
     font-weight: 600;
     font-size: 0.8em;
     padding: 6px 12px;
     border-radius: 6px;
     white-space: nowrap;
     box-shadow: 0 2px 4px rgba(0,0,0,0.2);
     text-align: center;
   }
    
    .note-date {
     font-size: 0.75em;
     color: #ccc;
     margin-bottom: 20px;
     margin-top: 8px;
    }
    .note-summary {
      text-align: left;
      font-size: 1em;
      color: #e0e0e0;
      font-weight: 400;
      line-height: 1.5em;
      flex-grow: 1;
      display: flex;
      align-items: center;
    }
    .notes-wrapper {
        max-width: 100%;
        box-sizing: border-box;
      }
    .add-note-btn {
      margin-bottom: 16px;  
      margin-left: 20px;
      background-color: #ffcc70;
      color: #001f3f;
      font-weight: bold;
      padding: 10px 20px;
      border: none;
      border-radius: 10px;
      cursor: pointer;
    }
   .tag-container {
     position: absolute;
     top: 8px;
     left: 16px;
     right: 16px;
     display: flex;
     gap: 8px;
     overflow-x: auto;
     padding-bottom: 4px;
     scrollbar-width: none;
   }
   
    .tag-container::-webkit-scrollbar {
      display: none;
    }
    .expanded-card {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      justify-content: center;
      align-items: center;
      z-index: 999;
    }
    .expanded-content {
      background-color: #012b52;
      color: white;
      border-radius: 16px;
      padding: 24px;
      max-width: 600px;
      width: 90%;
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      position: relative;
    }
    .expanded-content h3 {
      margin-top: 0;
    }
    .expanded-section {
      margin-bottom: 16px;
    }
    .close-expanded {
      position: absolute;
      top: 12px;
      right: 16px;
      font-size: 20px;
      font-weight: bold;
      color: white;
      cursor: pointer;
    }
    .expanded-link a {
      color: #ffcc70;
      word-break: break-all;
    }
      .comments-thread { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
      .comment-row { background: rgba(255,255,255,0.06); padding: 10px 12px; border-radius: 10px; }
      .comment-meta { font-size: 12px; color: #ccd; margin-bottom: 4px; display: flex; gap: 8px; }
      .comment-author { font-weight: 600; color: #ffcc70; }
      .comment-text { white-space: pre-wrap; word-break: break-word; }
      .comment-form { display: flex; gap: 8px; margin-top: 12px; }
      .comment-input { flex: 1; padding: 10px 12px; border-radius: 10px; border: none; background: #163f5f; color: white; }
      .comment-btn { background: #ffcc70; color: #001f3f; font-weight: 700; padding: 10px 14px; border: none; border-radius: 10px; cursor: pointer; }

  </style>
</head>
<body>
  <div class="top-nav">
    <div class="nav-left">
      <img src="/logo.png" alt="Logo" class="logo">
      <a href="/home" class="nav-text ${activePage === 'home' ? 'active' : ''}">Home</a>
      <a href="/notes" class="nav-text ${activePage === 'notes' ? 'active' : ''}">Notes</a>
    </div>
    <div class="nav-right">
      <form method="POST" action="/logout" style="margin: 0;">
        <button type="submit" style="background: none; border: none;">
          <img src="/logout-icon.png" alt="Logout" class="logout-icon" />
        </button>
      </form>
    </div>
  </div>

   ${generateAddNoteModal(allTags)}

   <div class="notes-wrapper">

     <div class="note-container">
       ${notes.map(renderNoteCard).join('')}
   </div>
 </div>
 <script>
   function expandNote(id) {
     const modal = document.getElementById("expanded-" + id);
     if (modal) modal.style.display = 'flex';
   }

   function closeNote(id) {
     const modal = document.getElementById("expanded-" + id);
     if (modal) modal.style.display = 'none';
   }

     function submitComment(noteId, formEl) {
       var input = formEl.elements['text'];
       var text = (input.value || '').trim();
       if (!text) return false;

       fetch('/notes/' + noteId + '/comments', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'Accept': 'application/json'
         },
         body: JSON.stringify({ text: text })
       })
       .then(function(res){ return res.json(); })
       .then(function(data){
         if (!data || !data.ok) return;

         // Append to thread safely using textContent (avoids HTML injection)
         var thread = document.getElementById('comments-' + noteId);
         if (!thread) return;

         var row = document.createElement('div');
         row.className = 'comment-row';

         var meta = document.createElement('div');
         meta.className = 'comment-meta';
         var author = document.createElement('span');
         author.className = 'comment-author';
         author.textContent = '@' + (data.comment.author || 'user');
         var date = document.createElement('span');
         date.className = 'comment-date';
         date.textContent = new Date(data.comment.createdAt).toLocaleString();
         meta.appendChild(author);
         meta.appendChild(date);

         var textDiv = document.createElement('div');
         textDiv.className = 'comment-text';
         textDiv.textContent = data.comment.text || '';

         row.appendChild(meta);
         row.appendChild(textDiv);
         thread.appendChild(row);

         input.value = '';
       })
       .catch(function(){ /* ignore or toast */ });

       // Prevent form navigation
       return false;
     }

 </script>
</body>
</html>`;
}

function generateAddNoteModal(allTags) {
  return `
    <button class="add-note-btn" onclick="openAddModal()">Add note</button>

    <div id="addNoteModal" class="modal-overlay" style="display: none;">
      <div class="modal-content">
        <button type="button" class="modal-close" onclick="closeAddModal()">×</button>

        <div class="modal-header">
          <div class="modal-header-left">
            <img src="/logo.png" alt="Logo" class="modal-logo" />
            <h3 class="modal-title">Add a New Note</h3>
          </div>
        </div>

        <form method="POST" action="/add-note" onsubmit="return validateBeforeSubmit()">
          <div class="modal-field"><input type="text" id="titleInput" name="title" class="modal-input" placeholder="Title" /></div>
          <div class="modal-field"><textarea id="contentInput" name="content" class="modal-input" rows="3" placeholder="Note"></textarea></div>
          <div class="modal-field"><input type="text" id="tagsInput" name="tags" class="modal-input" placeholder="Tag(s) comma-separated" /></div>
          <div class="modal-tag-list">
            ${allTags.map(tag => `
              <button type="button" class="tag-button" data-tag="${tag}" onclick="toggleTag(this, '${tag}')">${tag}</button>
            `).join('')}
          </div>
          <div class="modal-field"><input type="text" id="linkInput" name="link" class="modal-input" placeholder="Link" /></div>
          <button type="submit" id="submitNoteBtn" class="submit-note-btn" disabled>Add Note</button>
        </form>
      </div>
    </div>

    <script>
      function openAddModal() {
        document.getElementById('addNoteModal').style.display = 'flex';
      }

      function closeAddModal() {
        document.getElementById('addNoteModal').style.display = 'none';
        document.querySelectorAll('.modal-input').forEach(i => i.value = '');
        document.getElementById('submitNoteBtn').disabled = true;
        document.querySelectorAll('.tag-button.active').forEach(btn => btn.classList.remove('active'));
      }

      function toggleTag(button, tag) {
        const input = document.getElementById('tagsInput');
        let tags = input.value.split(',').map(t => t.trim()).filter(Boolean);
        const index = tags.indexOf(tag);

        if (index === -1) {
          tags.push(tag);
          button.classList.add('active');
        } else {
          tags.splice(index, 1);
          button.classList.remove('active');
        }

        input.value = tags.join(', ') + (tags.length > 0 ? ', ' : '');
        validateForm();
      }

      function validateForm() {
        const inputs = ['titleInput', 'contentInput', 'tagsInput', 'linkInput'];
        const isFilled = inputs.some(id => document.getElementById(id).value.trim() !== '');
        document.getElementById('submitNoteBtn').disabled = !isFilled;
      }

      function validateBeforeSubmit() {
        validateForm();
        return !document.getElementById('submitNoteBtn').disabled;
      }

      ['titleInput', 'contentInput', 'tagsInput', 'linkInput'].forEach(id => {
        document.addEventListener('input', function (e) {
          if (e.target.id === id) validateForm();
        });
      });
    </script>

    <style>
      .add-note-btn {
        margin-top: 10px;
        background-color: #ffcc70;
        color: #001f3f;
        font-weight: bold;
        padding: 10px 20px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
      }

      .modal-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 999;
      }

      .modal-content {
        background: rgba(1, 43, 82, 0.95);
        padding: 32px 24px;
        border-radius: 16px;
        width: 90%;
        max-width: 420px;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: white;
        gap: 16px;
        position: relative;
        box-sizing: border-box;
      }

      .modal-header {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 10px;
      }

      .modal-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .modal-logo {
        height: 28px;
      }

      .modal-title {
        margin: 0;
        font-size: 1.2em;
        font-weight: bold;
      }

      .modal-close {
        position: absolute;
        top: 16px;
        right: 16px;
        background-color: #012b52;
        color: white;
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        font-size: 20px;
        font-weight: bold;
        cursor: pointer;
        line-height: 30px;
        text-align: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      }

      .modal-input {
        padding: 14px 16px;
        border: none;
        border-radius: 12px;
        font-size: 1em;
        font-family: inherit;
        background-color: #163f5f;
        color: white;
        width: 100%;
        box-sizing: border-box;
      }

      .modal-input::placeholder {
        color: #ccc;
        font-family: inherit;
      }

      .modal-field {
        margin-bottom: 8px;
      }

      textarea.modal-input {
        resize: vertical;
        min-height: 80px;
      }

      .modal-tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
      }

      .tag-button {
        padding: 6px 12px;
        border-radius: 999px;
        background-color: rgba(255, 255, 255, 0.1);
        color: white;
        font-size: 0.85em;
        border: 1px solid rgba(255, 255, 255, 0.2);
        cursor: pointer;
      }

      .tag-button.active {
        background-color: #ffcc70;
        color: #001f3f;
        font-weight: bold;
      }

      .submit-note-btn {
        background-color: #ffcc70;
        color: #001f3f;
        font-weight: bold;
        padding: 12px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        margin-top: 8px;
      }
    </style>
  `;
}

function renderNoteCard(note) {
  const rawText = note.content || '';
  const isTooLong = rawText.length > 160;

  // What to show on the collapsed card:
  // - If there’s content, show it (truncate).
  // - Otherwise, show the link (if any).
  const displayText = rawText
    ? (isTooLong ? `${rawText.substring(0, 160)}…` : rawText)
    : (note.link || '');

  const comments = Array.isArray(note.comments) ? note.comments : [];

  return `
    <div class="note-card" onclick="expandNote('${note.id}')">
      <div class="tag-container">
        ${note.tags.map(tag => `<div class="tag-badge">${escapeHtml(tag)}</div>`).join('')}
      </div>
      <div class="note-date">${new Date(note.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</div>
      <div class="note-summary">${escapeHtml(displayText)}</div>
    </div>

    <div id="expanded-${note.id}" class="expanded-card" style="display: none;">
      <div class="expanded-content" onclick="event.stopPropagation()">
        <button class="close-expanded" onclick="closeNote('${note.id}')">×</button>

        <div class="expanded-section"><strong>Note:</strong><br>${escapeHtml(note.content || 'N/A')}</div>
        <div class="expanded-section expanded-link"><strong>Link:</strong><br>
          ${note.link ? `<a href="${escapeHtml(note.link)}" target="_blank">${escapeHtml(note.link)}</a>` : 'N/A'}
        </div>

        <!-- Comments -->
        <div class="expanded-section">
          <strong>Comments</strong>
          <div id="comments-${note.id}" class="comments-thread">
            ${comments.map(c => `
              <div class="comment-row">
                <div class="comment-meta">
                  <span class="comment-author">@${escapeHtml(c.author)}</span>
                  <span class="comment-date">${new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <div class="comment-text">${escapeHtml(c.text)}</div>
              </div>
            `).join('')}
          </div>

          <form class="comment-form" onsubmit="return submitComment('${note.id}', this)">
            <input type="text" name="text" class="comment-input" placeholder="Add a comment…" maxlength="1000" />
            <button type="submit" class="comment-btn">Add comment</button>
          </form>
        </div>
      </div>
    </div>
  `;
}



function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

// Debug route to view all data
app.get('/debug/db', async (req, res) => {
  try {
    const allKeys = await db.list();

    // Only inspect our own keys to avoid system/invalid values
    const safeKeys = allKeys.filter(k => k.startsWith('note:') || k.startsWith('user:'));

    const allData = {};
    for (const key of safeKeys) {
      try {
        // Normal get (parsed JSON); if it fails, fall back to raw string
        let val = await db.get(key);
        allData[key] = val;
      } catch (e) {
        try {
          // Some versions support { raw: true }. If not, we just mark it unreadable.
          const raw = await db.get(key, { raw: true });
          allData[key] = { _raw: raw };
        } catch {
          allData[key] = { _error: 'unreadable value' };
        }
      }
    }

    res.json(allData);
  } catch (error) {
    res.status(500).send("Error fetching DB (filtered): " + error);
  }
});


// Start server
initializeUsers().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log('Test accounts:');
    console.log('paula.minardi2@gmail.com / lene');
    console.log('bbclongo@hotmail.com / linho');
  });
}); 