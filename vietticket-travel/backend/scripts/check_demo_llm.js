'use strict';

require('dotenv').config({ quiet: true });

const { generateJSON } = require('../src/services/llmClient');

async function main() {
  try {
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

    console.log(`LLM tăng cường sẵn sàng qua provider: ${result.provider}`);
    console.log(`Mẫu tiêu đề: ${result.data.title}`);
    console.log(`Số mẹo nhận được: ${result.data.tips.length}`);
    return;
  } catch (providerError) {
    if (process.argv.includes('--require-provider')) throw providerError;

    console.warn(`CẢNH BÁO: LLM bên ngoài chưa sẵn sàng (${providerError.message}).`);
    console.warn('Đang xác minh lịch trình dự phòng có thể chạy độc lập...');
  }

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('Kiểm tra chủ động chế độ không có Internet');
  };

  const prisma = require('../src/config/prisma');
  try {
    const { generateItinerary } = require('../src/services/aiAssistantService');
    const result = await generateItinerary({
      city: 'Hồ Chí Minh',
      days: 2,
      adults: 2,
      children: 1,
      budget: 2_000_000,
      interests: 'Văn hóa, sinh thái',
      pace: 'normal',
      priority: 'balanced',
      companion: 'family',
    });

    const fallbackReady = result.provider === 'rule-based'
      && typeof result.data?.title === 'string'
      && result.data.title.trim()
      && Array.isArray(result.data?.days)
      && result.data.days.length > 0
      && Number(result.data?.estimatedCost?.total) >= 0;
    if (!fallbackReady) {
      throw new Error('Lịch trình dự phòng không trả đủ tiêu đề, ngày tham quan và chi phí.');
    }

    console.log(`FALLBACK READY: tạo được ${result.data.days.length} ngày bằng dữ liệu catalog nội bộ.`);
    console.log('Demo vẫn hoạt động; chỉ phần tiêu đề/mẹo sinh bởi LLM tạm thời không khả dụng.');
  } finally {
    global.fetch = originalFetch;
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`AI itinerary chưa sẵn sàng: ${error.message}`);
  process.exitCode = 1;
});
