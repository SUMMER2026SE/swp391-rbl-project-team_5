'use strict';

require('dotenv').config({ quiet: true });

const { generateJSON } = require('../src/services/llmClient');

async function main() {
  const result = await generateJSON(
    'Bạn là hướng dẫn viên du lịch. Chỉ trả JSON hợp lệ có title và tips.',
    'Tạo tiêu đề ngắn và đúng 3 mẹo ngắn cho gia đình tham quan Thành phố Hồ Chí Minh.',
    { maxOutputTokens: 256, temperature: 0.3, timeoutMs: 20000 },
  );

  const titleOk = typeof result.data?.title === 'string' && result.data.title.trim();
  const tipsOk = Array.isArray(result.data?.tips) && result.data.tips.length >= 1;
  if (!titleOk || !tipsOk) {
    throw new Error('Provider trả JSON nhưng thiếu title hoặc tips cần cho giao diện lịch trình.');
  }

  console.log(`LLM sẵn sàng qua provider: ${result.provider}`);
  console.log(`Mẫu tiêu đề: ${result.data.title}`);
  console.log(`Số mẹo nhận được: ${result.data.tips.length}`);
}

main().catch((error) => {
  console.error(`LLM chưa sẵn sàng: ${error.message}`);
  process.exitCode = 1;
});
