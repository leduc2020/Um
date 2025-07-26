const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const app = express();
const PORT = process.env.PORT || 3010;

const announcementPath = path.join(__dirname, 'announcement.json');
const adminConfigPath = path.join(__dirname, './admin-config.json');
let ADMIN_CONFIG = {};


function loadAdminConfig() {
  try {
    ADMIN_CONFIG = JSON.parse(fs.readFileSync(adminConfigPath, 'utf8'));
    console.log('Đã đọc cấu hình admin từ file JSON');
  } catch (err) {
    console.error('Lỗi khi đọc file cấu hình admin:', err);

    const defaultHash = bcrypt.hashSync('admin123', 10);
    ADMIN_CONFIG = {
      username: 'admin',
      passwordHash: defaultHash
    };
    fs.writeFileSync(adminConfigPath, JSON.stringify(ADMIN_CONFIG, null, 2));
    console.log('Đã tạo file cấu hình admin mặc định');
  }
}

loadAdminConfig();

function loadAnnouncement() {
  try {
    return JSON.parse(fs.readFileSync(announcementPath, 'utf8'));
  } catch (err) {
    return { active: false, title: '', content: '' };
  }
}


const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const requireLogin = (req, res, next) => {
  if (!req.session.loggedIn) {
    if (req.originalUrl.startsWith('/admin/api')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/trangquantri/login');
  }
  next();
};

app.use(session({
  secret: 'abcdefgh1234567890',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, 
    maxAge: 24 * 60 * 60 * 1000 
  }
}));


app.use(cors({
  origin: 'http://localhost:3010',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const settingsPath = path.join(__dirname, 'settings.json');
let SETTINGS = { maxFiles: 10, maxFileSizeMB: 100 };

function loadSettings() {
  try {
    SETTINGS = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    fs.writeFileSync(settingsPath, JSON.stringify(SETTINGS, null, 2));
  }
}
loadSettings();
const upload = multer({ storage }).array('files'); 

app.post('/admin/api/settings', requireLogin, (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Request body is missing or empty' 
    });
  }

  const maxFiles = parseInt(req.body.maxFiles) || SETTINGS.maxFiles;
  const maxFileSize = parseInt(req.body.maxFileSize) || SETTINGS.maxFileSizeMB;

  SETTINGS.maxFiles = maxFiles;
  SETTINGS.maxFileSizeMB = maxFileSize;
  
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(SETTINGS, null, 2));
    res.json({ 
      success: true,
      newSettings: SETTINGS 
    });
  } catch (err) {
    console.error('Error saving settings:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Could not save settings' 
    });
  }
});

// ================== ROUTES ================== //

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ================== ADMIN ROUTES ================== //

app.get('/trangquantri/login', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/trangquantri');
  }
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.post('/trangquantri/login', async (req, res) => {
  console.log('Login attempt:', req.body); 
  const { username, password } = req.body;

  console.log('ADMIN_CONFIG:', ADMIN_CONFIG); 
  const passwordMatch = await bcrypt.compare(password, ADMIN_CONFIG.passwordHash);
  console.log('Password match:', passwordMatch);

  if (username === ADMIN_CONFIG.username && passwordMatch) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }

  res.status(401).json({ 
    success: false, 
    error: 'Tên đăng nhập hoặc mật khẩu không đúng' 
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/trangquantri/login');
});

app.get('/trangquantri', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin/check-auth', (req, res) => {
  res.json({ loggedIn: !!req.session.loggedIn });
});

app.post('/admin/change-password', requireLogin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!await bcrypt.compare(currentPassword, ADMIN_CONFIG.passwordHash)) {
    return res.status(401).json({ success: false, error: 'Mật khẩu hiện tại không đúng' });
  }
  
  const newHash = await bcrypt.hash(newPassword, 10);
  ADMIN_CONFIG.passwordHash = newHash;
  
  try {
    fs.writeFileSync(adminConfigPath, JSON.stringify(ADMIN_CONFIG, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error('Lỗi khi lưu mật khẩu mới:', err);
    res.status(500).json({ success: false, error: 'Không thể lưu mật khẩu mới' });
  }
});

app.get('/admin/api/files', requireLogin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';
  
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Không thể đọc thư mục upload' });
    }
    
    let filteredFiles = files;
    if (search) {
      filteredFiles = files.filter(file => 
        file.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    filteredFiles.sort((a, b) => {
      const statA = fs.statSync(path.join(uploadDir, a));
      const statB = fs.statSync(path.join(uploadDir, b));
      return statB.birthtime - statA.birthtime;
    });
    
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);
    
    const fileList = paginatedFiles.map(file => {
      const filePath = path.join(uploadDir, file);
      const stats = fs.statSync(filePath);
      const ext = path.extname(file).toLowerCase();

      return {
        name: file,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        url: `/uploads/${file}`,
        isImage: ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext),
        isVideo: ['.mp4', '.webm', '.mov'].includes(ext),
        isAudio: ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext),
        type: ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? 'image' :
              ['.mp4', '.webm', '.mov'].includes(ext) ? 'video' :
              ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext) ? 'audio' : 'other'
      };
    });
    
    res.json({
      files: fileList,
      total: filteredFiles.length,
      totalPages: Math.ceil(filteredFiles.length / limit),
      currentPage: page
    });
  });
});

app.delete('/admin/api/files/:filename', requireLogin, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);
  
  if (!filePath.startsWith(uploadDir)) {
    return res.status(400).json({ error: 'Tên file không hợp lệ' });
  }
  
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Lỗi khi xóa file:', err);
      return res.status(500).json({ error: 'Không thể xóa file' });
    }
    res.json({ success: true });
  });
});

app.get('/admin/api/stats', requireLogin, (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Không thể đọc thư mục upload' });
    }
    
    let totalSize = 0;
    let fileCount = 0;
    let imageCount = 0;
    let videoCount = 0;
    let otherCount = 0;
    const recentFiles = [];
    
    files.forEach(file => {
      const filePath = path.join(uploadDir, file);
      try {
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        fileCount++;
        
        const ext = path.extname(file).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          imageCount++;
        } else if (['.mp4', '.webm', '.mov'].includes(ext)) {
          videoCount++;
        } else {
          otherCount++;
        }
        
        if (recentFiles.length < 5) {
          recentFiles.push({
            name: file,
            url: `/uploads/${file}`,
            date: stats.birthtime
          });
        }
      } catch (e) {
        console.error(`Không thể đọc thông tin file ${file}:`, e);
      }
    });
    
    recentFiles.sort((a, b) => b.date - a.date);
    
    res.json({
      totalFiles: fileCount,
      totalSize: totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      imageCount,
      videoCount,
      otherCount,
      recentFiles: recentFiles.map(f => ({
        name: f.name,
        url: f.url
      }))
    });
  });
});

// ================== UPLOAD ROUTES ================== //

app.post('/upload', (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Không có file nào được tải lên' 
      });
    }
    
    const fileUrls = req.files.map(file => {
      return `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;
    });
    
    res.json({ 
      success: true,
      urls: fileUrls 
    });
  });
});

app.post('/convert', async (req, res) => {
  try {
    const urls = req.body.urls;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Thiếu danh sách URL' 
      });
    }
    
    const results = [];
    
    for (const imageUrl of urls) {
      try {
        if (!isValidUrl(imageUrl)) {
          results.push({
            originalUrl: imageUrl,
            success: false,
            error: 'URL không hợp lệ'
          });
          continue;
        }
        
        const response = await axios({
          method: 'get',
          url: imageUrl,
          responseType: 'stream',
          timeout: 15000
        });
        
        let ext = path.extname(imageUrl.split('?')[0]);
        if (!ext) {
          const contentType = response.headers['content-type'];
          if (contentType) {
            if (contentType.includes('jpeg') || contentType.includes('jpg')) {
              ext = '.jpg';
            } else if (contentType.includes('png')) {
              ext = '.png';
            } else if (contentType.includes('gif')) {
              ext = '.gif';
            } else if (contentType.includes('mp4')) {
              ext = '.mp4';
            } else if (contentType.includes('webm')) {
              ext = '.webm';
            } else {
              ext = '.bin';
            }
          } else {
            ext = '.bin';
          }
        }
        
        const fileName = `converted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
        const filePath = path.join(uploadDir, fileName);
        const writer = fs.createWriteStream(filePath);
        
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        results.push({
          originalUrl: imageUrl,
          convertedUrl: `${req.protocol}://${req.get('host')}/uploads/${fileName}`,
          success: true
        });
      } catch (err) {
        results.push({
          originalUrl: imageUrl,
          success: false,
          error: err.message || 'Lỗi khi tải file'
        });
      }
    }
    
    res.json({ 
      success: true,
      results 
    });
  } catch (error) {
    console.error('Convert error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Lỗi server khi chuyển đổi' 
    });
  }
});
app.post('/admin/api/announcement', requireLogin, (req, res) => {
  const { title, content, active } = req.body;
  const announcement = { title, content, active: !!active };
  
  try {
    fs.writeFileSync(announcementPath, JSON.stringify(announcement, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error('Lỗi khi lưu thông báo:', err);
    res.status(500).json({ success: false, error: 'Không thể lưu thông báo' });
  }
});

app.get('/api/announcement', (req, res) => {
  try {
    const announcement = loadAnnouncement();
    res.json(announcement);
  } catch (err) {
    res.status(500).json({ error: 'Không thể tải thông báo' });
  }
});
app.get('/api/convert', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    
    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu tham số URL'
      });
    }
    
    if (!isValidUrl(imageUrl)) {
      return res.json({
        success: false,
        originalUrl: imageUrl,
        error: 'URL không hợp lệ'
      });
    }
    
    const response = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'stream',
      timeout: 15000
    });
    
    let ext = path.extname(imageUrl.split('?')[0]);
    if (!ext) {
      const contentType = response.headers['content-type'];
      if (contentType) {
        if (contentType.includes('jpeg') || contentType.includes('jpg')) {
          ext = '.jpg';
        } else if (contentType.includes('png')) {
          ext = '.png';
        } else if (contentType.includes('gif')) {
          ext = '.gif';
        } else if (contentType.includes('mp4')) {
          ext = '.mp4';
        } else if (contentType.includes('webm')) {
          ext = '.webm';
        } else {
          ext = '.bin';
        }
      } else {
        ext = '.bin';
      }
    }
    
    const fileName = `converted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
    const filePath = path.join(uploadDir, fileName);
    const writer = fs.createWriteStream(filePath);
    
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    res.json({
      success: true,
      originalUrl: imageUrl,
      convertedUrl: `${req.protocol}://${req.get('host')}/uploads/${fileName}`
    });
    
  } catch (err) {
    console.error('GET Convert error:', err);
    res.json({
      success: false,
      originalUrl: req.query.url,
      error: err.message || 'Lỗi khi tải file'
    });
  }
});

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
}


app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});