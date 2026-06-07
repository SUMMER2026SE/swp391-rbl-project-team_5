const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'styles', 'admin.css');

if (!fs.existsSync(cssPath)) {
  console.error(`Không tìm thấy file CSS tại: ${cssPath}`);
  process.exit(1);
}

console.log('Đang đọc file admin.css...');
const content = fs.readFileSync(cssPath, 'utf8');
const lines = content.split(/\r?\n/);

const outputLines = [];
let i = 0;

let conflictCount = 0;

while (i < lines.length) {
  const line = lines[i];

  if (line.startsWith('<<<<<<<')) {
    conflictCount++;
    // Bắt đầu khối conflict
    const headLines = [];
    const incomingLines = [];
    let state = 'HEAD'; // 'HEAD' hoặc 'INCOMING'
    i++; // Bỏ qua dòng <<<<<<<

    while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
      const currentLine = lines[i];
      if (currentLine.startsWith('=======')) {
        state = 'INCOMING';
      } else {
        if (state === 'HEAD') {
          headLines.push(currentLine);
        } else {
          incomingLines.push(currentLine);
        }
      }
      i++;
    }
    // Bỏ qua dòng >>>>>>>
    i++;

    console.log(`Đang xử lý xung đột thứ ${conflictCount}: ghép cả hai phiên bản (ưu tiên HEAD)...`);
    
    // Gộp cả 2: đưa incoming trước, HEAD sau để HEAD (code của mình) đè lên các thuộc tính trùng
    outputLines.push(...incomingLines);
    outputLines.push(...headLines);
  } else {
    outputLines.push(line);
    i++;
  }
}

fs.writeFileSync(cssPath, outputLines.join('\n'), 'utf8');
console.log(`=========================================`);
console.log(`Đã giải quyết xong ${conflictCount} khối xung đột trong admin.css!`);
console.log(`Đã lưu file sạch tại: ${cssPath}`);
console.log(`=========================================`);
