// ============================================================
// Nội dung làm giàu cho điểm tham quan: mô tả chi tiết + từ khoá
// tìm ảnh trên Wikimedia Commons.
// - Key = đúng `title` trong realAttractions.js.
// - description: mô tả dài thay cho mô tả ngắn ban đầu.
// - imageQueries: thứ tự ưu tiên khi tìm ảnh Commons; script sẽ
//   gộp kết quả các query đến khi đủ ảnh (mục tiêu >= 10).
// ============================================================

const attractionContent = {
  'Sun World Ba Na Hills': {
    description:
      'Sun World Ba Na Hills là khu du lịch nghỉ dưỡng trên đỉnh núi Chúa ở độ cao 1.487m, được mệnh danh là "châu Âu thu nhỏ giữa lòng Đà Nẵng". Điểm nhấn nổi tiếng toàn cầu là Cầu Vàng với hai bàn tay đá khổng lồ nâng đỡ dải cầu vàng óng giữa biển mây, từng được nhiều tạp chí quốc tế bình chọn là cây cầu ấn tượng nhất thế giới.\n\nDu khách di chuyển bằng hệ thống cáp treo đạt nhiều kỷ lục Guinness, tham quan Làng Pháp với quảng trường, nhà thờ, lâu đài cổ kính, vườn hoa Le Jardin D\'Amour 9 khu theo 9 phong cách, hầm rượu Debay trăm tuổi và chùa Linh Ứng với tượng Phật cao 27m. Khu vui chơi trong nhà Fantasy Park với hàng chục trò chơi hiện đại đã bao gồm trong giá vé. Khí hậu mát mẻ quanh năm, một ngày có thể trải nghiệm đủ bốn mùa.',
    imageQueries: ['"Ba Na Hills"', 'Golden Bridge Da Nang', 'Sun World Ba Na Hills'],
  },
  'VinWonders Nha Trang': {
    description:
      'VinWonders Nha Trang là tổ hợp công viên giải trí hàng đầu Việt Nam nằm trên đảo Hòn Tre, kết nối với đất liền bằng tuyến cáp treo vượt biển dài hơn 3.300m — một trong những tuyến cáp treo trên biển dài nhất thế giới. Công viên gồm 6 phân khu: thế giới trò chơi cảm giác mạnh, công viên nước với hệ thống đường trượt đa dạng, thủy cung vòm kính với hàng nghìn sinh vật biển, khu vườn cổ tích, phố mua sắm và quảng trường nhạc nước.\n\nBuổi tối du khách có thể thưởng thức show nhạc nước Tata Show hoành tráng. Vé trọn gói bao gồm cáp treo khứ hồi và toàn bộ trò chơi, phù hợp cho gia đình vui chơi cả ngày giữa khung cảnh vịnh Nha Trang — một trong những vịnh biển đẹp nhất thế giới.',
    imageQueries: ['VinWonders Nha Trang', 'Vinpearl Nha Trang', 'Hon Tre island Nha Trang'],
  },
  'Du thuyền Vịnh Hạ Long (tour ngày)': {
    description:
      'Vịnh Hạ Long — kỳ quan thiên nhiên thế giới được UNESCO hai lần công nhận — là quần thể gần 2.000 đảo đá vôi lớn nhỏ nhô lên từ làn nước xanh ngọc bích, tạo nên khung cảnh huyền ảo bậc nhất hành tinh. Tour du thuyền trong ngày đưa du khách len lỏi qua các đảo đá hình thù kỳ thú như hòn Trống Mái, hòn Đỉnh Hương, ghé thăm hang Sửng Sốt — hang động lớn và đẹp nhất vịnh với hệ thống nhũ đá tráng lệ.\n\nHành trình bao gồm leo 400 bậc lên đỉnh đảo Ti Tốp ngắm toàn cảnh vịnh, tắm biển tại bãi cát trắng hình vầng trăng, chèo kayak hoặc đi thuyền nan khám phá làng chài, hang Luồn. Bữa trưa hải sản được phục vụ ngay trên du thuyền giữa khung cảnh non nước hùng vĩ.',
    imageQueries: ['Ha Long Bay', 'Sung Sot cave Ha Long', 'Ti Top island'],
  },
  'Cáp treo Fansipan Sa Pa': {
    description:
      'Tuyến cáp treo ba dây hiện đại đưa du khách từ thung lũng Mường Hoa lên đỉnh Fansipan 3.143m — "Nóc nhà Đông Dương" — chỉ trong 15 phút thay vì 2 ngày leo núi. Cáp treo giữ kỷ lục Guinness về độ chênh ga đi và ga đến lớn nhất thế giới (1.410m), mở ra tầm nhìn ngoạn mục xuống thung lũng ruộng bậc thang và dãy Hoàng Liên Sơn trùng điệp.\n\nTrên đỉnh là quần thể văn hóa tâm linh ấn tượng với Đại tượng Phật A Di Đà bằng đồng cao 21,5m, chùa Trình, Bích Vân thiền tự và hệ thống tượng La Hán dọc đường lên đỉnh. Vào mùa săn mây (tháng 10 đến tháng 4), du khách có cơ hội đứng trên biển mây bồng bềnh đón hoàng hôn — trải nghiệm được ví như "chạm tay vào nóc nhà Đông Dương".',
    imageQueries: ['Fansipan', 'Fansipan cable car', 'Fansipan summit Sapa'],
  },
  'Khu du lịch sinh thái Tràng An': {
    description:
      'Tràng An là vùng lõi của Quần thể danh thắng Tràng An — di sản hỗn hợp văn hóa và thiên nhiên thế giới đầu tiên của Việt Nam được UNESCO công nhận. Du khách ngồi thuyền nan do người dân địa phương chèo tay, xuôi theo dòng sông Ngô Đồng trong vắt, xuyên qua hàng loạt hang động xuyên thủy kỳ ảo như hang Tối, hang Sáng, hang Nấu Rượu, mỗi hang một vẻ với nhũ đá rủ sát mặt nước.\n\nHai bên là những dãy núi đá vôi dựng đứng phủ cây xanh, xen kẽ các thung lũng ngập nước yên bình và những ngôi đền cổ như đền Trình, đền Trần, phủ Khống. Nơi đây còn nổi tiếng với phim trường Kong: Skull Island. Ba tuyến thuyền với thời lượng 2–3 tiếng cho du khách lựa chọn, đẹp nhất vào mùa lúa chín tháng 5–6.',
    imageQueries: ['Trang An Ninh Binh', 'Trang An landscape complex', 'Trang An boat'],
  },
  'Phố cổ Hội An': {
    description:
      'Phố cổ Hội An — di sản văn hóa thế giới UNESCO — là thương cảng quốc tế sầm uất thế kỷ 16–17 được bảo tồn gần như nguyên vẹn, nơi giao thoa kiến trúc Việt, Hoa, Nhật và phương Tây. Những con phố nhỏ với nhà cổ mái ngói rêu phong, tường vàng đặc trưng, Chùa Cầu biểu tượng hơn 400 năm tuổi, các hội quán Phúc Kiến, Quảng Đông lộng lẫy và nhà cổ Tấn Ký, Phùng Hưng trăm năm tuổi.\n\nVé tham quan cho phép vào 5 trong số hơn 20 điểm di tích. Hội An đẹp nhất khi đèn lồng thắp sáng lúc hoàng hôn, du khách có thể thả hoa đăng trên sông Hoài, nghe hát bài chòi, thưởng thức cao lầu, cơm gà, bánh mì trứ danh. Đêm rằm hàng tháng phố cổ tắt đèn điện, chỉ còn ánh đèn lồng huyền ảo.',
    imageQueries: ['Hoi An ancient town', 'Hoi An lanterns', 'Japanese Covered Bridge Hoi An'],
  },
  'Thánh địa Mỹ Sơn': {
    description:
      'Thánh địa Mỹ Sơn — di sản văn hóa thế giới UNESCO — là quần thể đền tháp Chăm Pa cổ nhất và quan trọng nhất Đông Nam Á, được xây dựng liên tục từ thế kỷ 4 đến thế kỷ 13 trong thung lũng kín đáo được bao bọc bởi núi non. Hơn 70 công trình đền tháp bằng gạch nung đỏ thờ thần Shiva, với kỹ thuật xây dựng không vữa kết dính đến nay vẫn là điều bí ẩn với giới khoa học.\n\nNhững tháp Chăm còn lại mang đậm phong cách nghệ thuật Ấn Độ giáo với phù điêu vũ nữ Apsara, thần linh và linh vật tinh xảo. Du khách được xem biểu diễn múa Chăm truyền thống miễn phí trong khuôn viên. Nên đi sáng sớm để tránh nắng và đón ánh bình minh huyền ảo trên những phế tích nghìn năm tuổi.',
    imageQueries: ['My Son sanctuary', 'My Son Cham towers', 'My Son Vietnam temple'],
  },
  'Dinh Độc Lập': {
    description:
      'Dinh Độc Lập (Hội trường Thống Nhất) là chứng nhân lịch sử quan trọng bậc nhất của Việt Nam thế kỷ 20 — nơi chiếc xe tăng 390 húc đổ cổng chính trưa ngày 30/4/1975, đánh dấu kết thúc chiến tranh và thống nhất đất nước. Công trình do kiến trúc sư Ngô Viết Thụ thiết kế theo phong cách hiện đại kết hợp triết lý phương Đông, từng là nơi ở và làm việc của Tổng thống Việt Nam Cộng hòa.\n\nDu khách tham quan hơn 100 căn phòng nguyên trạng: phòng khánh tiết, phòng nội các, phòng làm việc tổng thống, khu hầm chỉ huy với hệ thống thông tin liên lạc thời chiến, sân thượng có trực thăng UH-1 và khuôn viên trưng bày xe tăng lịch sử. Đây là điểm đến không thể bỏ qua để hiểu về lịch sử hiện đại Việt Nam.',
    imageQueries: ['Independence Palace Ho Chi Minh City', 'Reunification Palace Saigon', 'Dinh Doc Lap'],
  },
  'Bảo tàng Chứng tích Chiến tranh': {
    description:
      'Bảo tàng Chứng tích Chiến tranh là một trong những bảo tàng thu hút khách quốc tế nhất Việt Nam, lưu giữ hơn 20.000 tài liệu, hiện vật và phim ảnh về hậu quả các cuộc chiến tranh tại Việt Nam. Các chuyên đề trưng bày gây xúc động mạnh: hậu quả chất độc da cam/dioxin, tội ác chiến tranh, bộ sưu tập ảnh phóng sự chiến trường "Hồi Niệm" của 134 phóng viên thiệt mạng trong chiến tranh.\n\nKhu trưng bày ngoài trời có máy bay chiến đấu, xe tăng, pháo và mô hình "chuồng cọp" nhà tù Côn Đảo được phục dựng nguyên bản. Bảo tàng được nhiều du khách quốc tế đánh giá là điểm đến thay đổi nhận thức sâu sắc về chiến tranh và giá trị của hòa bình.',
    imageQueries: ['War Remnants Museum', 'War Remnants Museum Ho Chi Minh City aircraft'],
  },
  'Địa đạo Củ Chi': {
    description:
      'Địa đạo Củ Chi là hệ thống đường hầm dài hơn 250km được đào hoàn toàn bằng dụng cụ thô sơ trong lòng đất sét pha laterite, được mệnh danh là "thành phố trong lòng đất" với đầy đủ bệnh xá, nhà bếp Hoàng Cầm, phòng họp, xưởng chế tạo vũ khí ở ba tầng sâu khác nhau. Đây là căn cứ địa cách mạng huyền thoại trong hai cuộc kháng chiến.\n\nDu khách được trải nghiệm chui hầm địa đạo đã mở rộng, xem hệ thống bẫy chông, hố đinh, nắp hầm bí mật ngụy trang tinh vi, thưởng thức khoai mì chấm muối vừng — món ăn thời chiến, và có thể thử bắn súng thể thao tại trường bắn. Khu di tích Bến Dược còn có đền tưởng niệm liệt sĩ trang nghiêm bên sông Sài Gòn.',
    imageQueries: ['Cu Chi tunnels', 'Cu Chi tunnel entrance', 'Cu Chi Vietnam war'],
  },
  'Văn Miếu - Quốc Tử Giám': {
    description:
      'Văn Miếu – Quốc Tử Giám là quần thể di tích gần 1.000 năm tuổi, nơi thờ Khổng Tử và là trường đại học đầu tiên của Việt Nam (thành lập năm 1076), biểu tượng của truyền thống hiếu học dân tộc. Quần thể gồm 5 lớp sân vườn nối tiếp qua các cổng Văn Miếu Môn, Đại Trung Môn, đến Khuê Văn Các — gác vọng nguyệt được chọn làm biểu tượng của Thủ đô Hà Nội.\n\nĐiểm quý giá nhất là 82 bia tiến sĩ đặt trên lưng rùa đá ghi danh các nhà khoa bảng từ 1442 đến 1779, được UNESCO công nhận là Di sản tư liệu thế giới. Vào mùa thi, sĩ tử khắp nơi về đây cầu may mắn; dịp Tết có hội chữ xin chữ ông đồ đậm nét văn hóa truyền thống.',
    imageQueries: ['Temple of Literature Hanoi', 'Van Mieu Hanoi', 'Khue Van Cac'],
  },
  'Hoàng thành Thăng Long': {
    description:
      'Hoàng thành Thăng Long — di sản văn hóa thế giới UNESCO — là trung tâm quyền lực liên tục suốt 13 thế kỷ của các vương triều Việt Nam, từ thời Đại La, qua Lý, Trần, Lê đến Nguyễn. Khu di tích nổi bật với Đoan Môn cổng thành uy nghi, Cột cờ Hà Nội cao 33m, điện Kính Thiên với đôi rồng đá thời Lê tuyệt đẹp, Hậu Lâu và Bắc Môn còn vết đạn pháo thời Pháp.\n\nKhu khảo cổ 18 Hoàng Diệu hé lộ các tầng văn hóa chồng xếp với hàng triệu hiện vật quý. Du khách còn được thăm hầm chỉ huy D67 và T1 — nơi Bộ Chính trị, Quân ủy Trung ương ra những quyết định lịch sử trong kháng chiến chống Mỹ. Khuôn viên rộng rãi rợp bóng cây là nơi check-in áo dài được giới trẻ yêu thích.',
    imageQueries: ['Imperial Citadel Thang Long', 'Doan Mon Hanoi', 'Hanoi flag tower'],
  },
  'VinWonders Phú Quốc': {
    description:
      'VinWonders Phú Quốc là công viên chủ đề lớn nhất Việt Nam và hàng đầu Đông Nam Á với diện tích 50ha, gồm 6 phân khu theo chủ đề 12 nền văn minh nhân loại với hơn 100 trò chơi và hoạt động. Điểm nhấn là lâu đài Mặt Trời Mộc Diên Vương cao 50m — biểu tượng check-in nổi tiếng, cung điện hải vương Aquarium hình rùa khổng lồ nuôi hơn 30.000 sinh vật biển, và công viên nước với 20 đường trượt cảm giác mạnh.\n\nBuổi tối, show diễn công nghệ "Sắc màu Venice" với nhạc nước, ánh sáng 3D mapping trên sân khấu hồ nước rộng lớn là trải nghiệm không thể bỏ lỡ. Công viên nằm trong quần thể Phú Quốc United Center cùng Grand World và Vinpearl Safari, thuận tiện kết hợp tham quan trong ngày.',
    imageQueries: ['VinWonders Phu Quoc', 'Phu Quoc United Center', 'Vinpearl Phu Quoc'],
  },
  'Cáp treo Hòn Thơm Phú Quốc': {
    description:
      'Cáp treo Hòn Thơm giữ kỷ lục Guinness là tuyến cáp treo ba dây vượt biển dài nhất thế giới với 7.899,9m, nối thị trấn An Thới với đảo Hòn Thơm. Trong 15 phút bay trên độ cao 160m, du khách được chiêm ngưỡng toàn cảnh quần đảo An Thới với hàng chục hòn đảo lớn nhỏ, làng chài, đoàn tàu đánh cá và làn nước xanh ngọc lục bảo tuyệt đẹp phía nam đảo ngọc.\n\nTại Hòn Thơm, du khách tự do vui chơi tại công viên nước Aquatopia với hơn 20 trò chơi, tắm biển bãi Trào nước trong vắt, trải nghiệm các môn thể thao biển hoặc khám phá Exotica Village. Ga đi An Thới được thiết kế như thị trấn Địa Trung Hải đầy màu sắc — điểm check-in nổi tiếng của Phú Quốc.',
    imageQueries: ['Hon Thom cable car', 'Phu Quoc cable car', 'An Thoi islands Phu Quoc'],
  },
  'Thảo Cầm Viên Sài Gòn': {
    description:
      'Thảo Cầm Viên Sài Gòn xây dựng từ năm 1864 là vườn thú lâu đời nhất Việt Nam và nằm trong nhóm các vườn thú cổ nhất thế giới, rộng 17ha ngay trung tâm thành phố. Nơi đây chăm sóc hơn 1.300 cá thể động vật thuộc 125 loài, trong đó nhiều loài quý hiếm như hổ Đông Dương, voi châu Á, hà mã, hươu cao cổ, cùng thảm thực vật hơn 1.800 cây cổ thụ quý.\n\nVới giá vé rất phải chăng, đây là điểm vui chơi cuối tuần quen thuộc của các gia đình có trẻ nhỏ: xem biểu diễn thú, khu vui chơi thiếu nhi, vườn bướm, nhà bò sát. Trong khuôn viên còn có Đền thờ Vua Hùng và Bảo tàng Lịch sử TP.HCM tạo thành cụm tham quan văn hóa - sinh thái độc đáo giữa lòng đô thị.',
    imageQueries: ['Saigon Zoo and Botanical Gardens', 'Thao Cam Vien Saigon'],
  },
  'Sun World Danang Wonders (Công viên Châu Á)': {
    description:
      'Sun World Danang Wonders (Asia Park) là công viên giải trí rộng 70ha bên bờ sông Hàn, nổi bật với vòng quay Sun Wheel cao 115m — một trong những vòng quay lớn nhất thế giới, mang đến tầm nhìn toàn cảnh thành phố Đà Nẵng lung linh về đêm. Công viên tái hiện văn hóa 10 quốc gia châu Á qua các công trình biểu tượng: tháp đồng hồ, cổng Nhật, đền Ấn Độ, thuyền rồng Trung Hoa.\n\nKhu trò chơi có tàu lượn siêu tốc Garuda Valley, tàu điện trên cao Monorail vòng quanh công viên, Singapore Sling, Queen Cobra cùng hàng chục trò cảm giác mạnh và khu trò chơi gia đình. Công viên mở cửa buổi chiều tối, là lựa chọn lý tưởng sau một ngày tắm biển, với nhiều lễ hội và show diễn đường phố theo mùa.',
    imageQueries: ['Asia Park Da Nang', 'Sun Wheel Da Nang', 'Sun World Danang Wonders'],
  },
  'Danh thắng Ngũ Hành Sơn': {
    description:
      'Ngũ Hành Sơn là quần thể 5 ngọn núi đá vôi mang tên ngũ hành (Kim - Mộc - Thủy - Hỏa - Thổ) nổi lên giữa vùng cát ven biển Đà Nẵng, gắn liền với huyền thoại trứng Rồng của Long Quân. Ngọn Thủy Sơn lớn nhất là trung tâm tham quan với hệ thống hang động kỳ ảo: động Huyền Không có giếng trời tự nhiên rọi ánh sáng huyền diệu, động Âm Phủ tái hiện cảnh luân hồi, cùng các chùa cổ Tam Thai, Linh Ứng hơn 300 năm.\n\nDu khách có thể đi thang máy hoặc leo 156 bậc đá lên núi, từ Vọng Giang Đài và Vọng Hải Đài ngắm toàn cảnh sông Cổ Cò, biển Non Nước. Dưới chân núi là làng nghề điêu khắc đá mỹ nghệ Non Nước hơn 400 năm tuổi — di sản văn hóa phi vật thể quốc gia.',
    imageQueries: ['Marble Mountains Da Nang', 'Ngu Hanh Son', 'Huyen Khong cave'],
  },
  'Đại Nội Huế': {
    description:
      'Đại Nội Huế — trái tim của Quần thể di tích Cố đô Huế được UNESCO công nhận di sản văn hóa thế giới — là kinh đô của triều Nguyễn suốt 143 năm (1802–1945). Vòng thành rộng hơn 500ha với Ngọ Môn uy nghi, điện Thái Hòa nơi đặt ngai vàng và diễn ra đại lễ triều đình, Tử Cấm Thành nơi sinh hoạt của hoàng gia, cung Diên Thọ của Hoàng thái hậu và Thế Miếu với Cửu Đỉnh — bảo vật quốc gia.\n\nNhiều công trình đã được trùng tu lộng lẫy như điện Kiến Trung, trường lang sơn son thếp vàng. Du khách nên dành ít nhất nửa ngày, thuê thuyết minh hoặc trải nghiệm VR để hiểu trọn lịch sử. Vé Đại Nội có thể mua kèm tuyến lăng tẩm với giá ưu đãi; buổi tối có chương trình "Huế by night" thắp sáng hoàng cung.',
    imageQueries: ['Hue Imperial City', 'Ngo Mon gate Hue', 'Thai Hoa palace Hue'],
  },
  'Lăng Khải Định': {
    description:
      'Lăng Khải Định (Ứng Lăng) là lăng tẩm độc đáo nhất trong hệ thống lăng vua triều Nguyễn, xây dựng suốt 11 năm (1920–1931) trên núi Châu Chữ, kết hợp táo bạo kiến trúc Đông - Tây: cổng theo phong cách Ấn Độ giáo, trụ biểu dạng stupa Phật giáo, hàng rào như thánh giá Gothic. Tuy diện tích nhỏ nhất nhưng đây là lăng tốn kém và tinh xảo nhất.\n\nĐiểm đỉnh cao nghệ thuật là cung Thiên Định với nội thất khảm sành sứ và thủy tinh dày đặc tạo nên những bức tranh tường rực rỡ, bức "Cửu long ẩn vân" trên trần do nghệ nhân vẽ bằng chân, cùng tượng đồng vua Khải Định đúc tại Pháp đặt trên mộ phần. Từ sân lăng, du khách phóng tầm mắt ra khung cảnh đồi núi xanh ngắt vùng ngoại ô Huế.',
    imageQueries: ['Khai Dinh tomb', 'Thien Dinh palace Khai Dinh', 'Ung Lang Hue'],
  },
  'Động Phong Nha': {
    description:
      'Động Phong Nha — "Thiên Nam đệ nhất động" — là hang động nước nổi tiếng nhất của Vườn quốc gia Phong Nha - Kẻ Bàng, di sản thiên nhiên thế giới UNESCO với hệ thống karst hơn 400 triệu năm tuổi. Du khách ngồi thuyền từ bến sông Son xanh màu ngọc bích, len qua cửa hang rồi tắt máy chèo tay vào sâu 1.500m trong lòng hang tối kỳ ảo, nơi sông ngầm dài 13.969m ẩn mình.\n\nHệ thống thạch nhũ muôn hình vạn trạng được chiếu sáng nghệ thuật: hình sư tử, kỳ lân, tòa sen, cung đình... Trên đường về, thuyền dừng cho khách đi bộ trên bãi cát ngầm trong hang ngắm măng đá khổng lồ. Có thể kết hợp tham quan động Tiên Sơn — "hang khô" tuyệt đẹp nằm ngay phía trên cửa động Phong Nha.',
    imageQueries: ['Phong Nha cave', 'Phong Nha Ke Bang', 'Son river Phong Nha'],
  },
  'Động Thiên Đường': {
    description:
      'Động Thiên Đường được Hiệp hội hang động Hoàng gia Anh đánh giá là hang động khô dài nhất châu Á với 31,4km, ẩn mình trong vùng lõi di sản thiên nhiên thế giới Phong Nha - Kẻ Bàng. Đúng như tên gọi "Paradise Cave", hang gây choáng ngợp ngay từ những bậc thang đầu tiên dẫn xuống lòng hang rộng tới 150m, cao hơn 60m với hệ thống cầu gỗ dài hơn 1km phục vụ tham quan.\n\nThạch nhũ và măng đá nơi đây được giới chuyên môn đánh giá tráng lệ bậc nhất: cột Thạch Hoa Viên, tháp Liên Hoa, nhà Rông Tây Nguyên, ruộng bậc thang... lung linh dưới ánh đèn vàng. Không khí trong hang mát lạnh quanh năm 18–20°C. Du khách ưa mạo hiểm có thể đặt tour khám phá sâu 7km chiêm ngưỡng giếng trời và sông ngầm.',
    imageQueries: ['Paradise Cave Vietnam', 'Thien Duong cave', 'Paradise cave Quang Binh'],
  },
  'Sun World Núi Bà Đen': {
    description:
      'Núi Bà Đen cao 986m — "Nóc nhà Nam Bộ" — là ngọn núi thiêng gắn với truyền thuyết Linh Sơn Thánh Mẫu, mỗi năm đón hàng triệu lượt khách hành hương. Hệ thống cáp treo hiện đại với ga Bà Đen giữ kỷ lục Guinness "nhà ga cáp treo lớn nhất thế giới" đưa khách lên đỉnh núi chỉ trong 8 phút, ngắm toàn cảnh đồng bằng Tây Ninh và hồ Dầu Tiếng mênh mông.\n\nTrên đỉnh là quần thể tâm linh kỳ vĩ: tượng Phật Bà Tây Bổ Đà Sơn bằng đồng cao nhất châu Á đặt trên đỉnh núi (72m tính cả đế), tượng Bồ Tát Di Lặc bằng đá sa thạch lớn hàng đầu thế giới, trụ kinh Bát Nhã và khu triển lãm Phật giáo công nghệ 3D mapping. Cụm chùa Bà linh thiêng ở lưng chừng núi cũng có tuyến cáp riêng phục vụ khách lễ chùa.',
    imageQueries: ['Ba Den mountain', 'Nui Ba Den Tay Ninh', 'Ba Den Buddha statue'],
  },
  'Khu du lịch Suối Tiên': {
    description:
      'Suối Tiên là công viên giải trí mang chủ đề văn hóa tâm linh độc đáo bậc nhất thế giới, nơi các truyền thuyết Việt Nam như Lạc Long Quân - Âu Cơ, Sơn Tinh - Thủy Tinh, tứ linh Long - Lân - Quy - Phụng được tái hiện bằng những công trình khổng lồ rực rỡ sắc màu. Nổi bật là biển Tiên Đồng - Ngọc Nữ: biển nhân tạo trong công viên với núi Lạc Long Quân phun thác cao 70m.\n\nCông viên rộng 50ha có hơn 150 công trình vui chơi: Long Hoa Thiên Bảo, cung điện Vua Hùng, lâu đài cá sấu với hàng nghìn con, khu trò chơi cảm giác mạnh, phim 4D... Đây là điểm vui chơi cuối tuần quen thuộc của người Sài Gòn và từng được tạp chí quốc tế xếp vào nhóm công viên giải trí độc đáo nhất hành tinh.',
    imageQueries: ['Suoi Tien theme park', 'Suoi Tien Ho Chi Minh City'],
  },
  'Công viên văn hóa Đầm Sen': {
    description:
      'Đầm Sen là công viên văn hóa - giải trí lâu đời và quy mô hàng đầu Sài Gòn với diện tích 50ha, trong đó 20% là hồ nước và 60% cây xanh, được ví như "lá phổi xanh" giữa lòng thành phố. Công viên có hơn 40 trò chơi từ nhẹ nhàng đến cảm giác mạnh: tàu lượn siêu tốc, vòng quay khổng lồ, thuyền lắc, cùng khu công viên nước Đầm Sen Water Park liền kề.\n\nKhông gian văn hóa đa dạng với vườn Nam Tú Thượng Uyển, cầu Cửu Khúc, đảo Thiên Tiên, vườn chim, sân khấu nhạc nước hiện đại và các lễ hội hoa rực rỡ dịp Tết. Với giá vé phải chăng và nhiều chương trình biểu diễn cuối tuần, Đầm Sen là lựa chọn quen thuộc cho gia đình có trẻ nhỏ và các nhóm bạn trẻ.',
    imageQueries: ['Dam Sen park', 'Dam Sen Water Park', 'Dam Sen Ho Chi Minh'],
  },
  'Landmark 81 SkyView': {
    description:
      'Landmark 81 SkyView là đài quan sát trên những tầng cao nhất (79–81) của tòa nhà Landmark 81 — tòa nhà cao nhất Việt Nam với 461,2m, lấy cảm hứng thiết kế từ bó tre vươn thẳng lên trời. Từ độ cao gần nửa cây số, du khách ôm trọn toàn cảnh TP.HCM 360 độ: sông Sài Gòn uốn lượn, trung tâm quận 1, và đường chân trời thành phố rực rỡ nhất lúc hoàng hôn buông.\n\nTrải nghiệm đặc biệt gồm sàn kính Skywalk nhìn xuyên xuống độ cao 380m, kính viễn vọng thực tế ảo, quầy cà phê tầng 81 và khu vực chụp ảnh nghệ thuật. Vé có thể nâng hạng lên gói cao cấp kèm đồ uống. Đây là điểm hẹn hò và check-in sang trọng bậc nhất Sài Gòn, đặc biệt lung linh khi thành phố lên đèn.',
    imageQueries: ['Landmark 81', 'Landmark 81 Ho Chi Minh City', 'Landmark 81 skyline'],
  },
  'Cáp treo Yên Tử': {
    description:
      'Yên Tử là ngọn núi thiêng — "đất tổ Phật giáo Việt Nam" — nơi vua Trần Nhân Tông từ bỏ ngai vàng tu hành và sáng lập Thiền phái Trúc Lâm hơn 700 năm trước. Hai chặng cáp treo đưa du khách qua rừng quốc gia nguyên sinh với rừng tùng cổ, trúc xanh ngút ngàn lên gần chùa Đồng — ngôi chùa bằng đồng nguyên khối nặng 70 tấn tọa lạc trên đỉnh núi 1.068m giữa biển mây.\n\nHành trình tâm linh đi qua chùa Hoa Yên uy nghi, tượng Phật hoàng Trần Nhân Tông bằng đồng 138 tấn, chùa Một Mái nép mình vách núi, vườn tháp Huệ Quang cổ kính. Dù có cáp treo, du khách vẫn cần leo bộ một số đoạn đá núi — trải nghiệm hành hương trọn vẹn nhất vào mùa xuân lễ hội (tháng 1–3 âm lịch).',
    imageQueries: ['Yen Tu mountain', 'Dong pagoda Yen Tu', 'Yen Tu Quang Ninh'],
  },
  'Tam Cốc - Bích Động': {
    description:
      'Tam Cốc - Bích Động được mệnh danh là "Vịnh Hạ Long trên cạn" — tuyến du thuyền nan trên sông Ngô Đồng xuyên qua ba hang động tự nhiên (hang Cả, hang Hai, hang Ba) với trần hang thấp rủ đầy nhũ đá, hai bên là vách núi đá vôi sừng sững soi bóng xuống dòng sông uốn lượn giữa cánh đồng lúa. Người lái đò nơi đây nổi tiếng với kỹ thuật chèo thuyền bằng chân điêu luyện.\n\nMùa lúa chín cuối tháng 5 đầu tháng 6, thung lũng nhuộm vàng rực hai bờ sông tạo nên khung cảnh đẹp nhất miền Bắc. Cách bến thuyền 3km là chùa Bích Động — "Nam thiên đệ nhị động" — ngôi chùa cổ ba tầng (Hạ, Trung, Thượng) tựa lưng vào núi đá với cổng tam quan rêu phong bên hồ sen tuyệt đẹp.',
    imageQueries: ['Tam Coc', 'Tam Coc Ninh Binh', 'Bich Dong pagoda'],
  },
  'Chùa Bái Đính': {
    description:
      'Chùa Bái Đính là quần thể chùa lớn nhất Việt Nam và Đông Nam Á với diện tích 539ha, sở hữu nhiều kỷ lục châu Á: tượng Phật Thích Ca bằng đồng dát vàng 100 tấn lớn nhất châu Á, hành lang 500 tượng La Hán đá dài gần 3km, tháp chuông với đại hồng chung 36 tấn, và Bảo tháp 13 tầng cao nhất Đông Nam Á lưu giữ xá lợi Phật từ Ấn Độ.\n\nQuần thể gồm khu chùa cổ nghìn năm trong hang động núi Bái Đính linh thiêng và khu chùa mới nguy nga với điện Tam Thế, điện Pháp Chủ mái cong trùng điệp. Du khách di chuyển bằng xe điện từ cổng vào. Chùa đẹp huyền ảo lúc hoàng hôn lên đèn; lễ hội đầu xuân (mùng 6 Tết đến hết tháng 3 âm lịch) thu hút hàng triệu phật tử.',
    imageQueries: ['Bai Dinh pagoda', 'Bai Dinh temple Ninh Binh', 'Bai Dinh buddha'],
  },
  'Di tích Nhà tù Hỏa Lò': {
    description:
      'Nhà tù Hỏa Lò do thực dân Pháp xây dựng năm 1896 — từng được mệnh danh là "địa ngục trần gian" giữa lòng Hà Nội — là nơi giam giữ hàng nghìn chiến sĩ cách mạng Việt Nam, sau này giam phi công Mỹ và được họ gọi hài hước là "Hanoi Hilton". Di tích trưng bày chân thực: máy chém, xà lim tử tù, cùm chân tập thể, cống ngầm vượt ngục huyền thoại năm 1945.\n\nHỏa Lò gây ấn tượng mạnh với cách kể chuyện hiện đại: tour đêm "Đêm thiêng liêng" với hoạt cảnh tái hiện xúc động, hệ thống thuyết minh tự động sinh động, và truyền thông sáng tạo thu hút giới trẻ. Đây là một trong những điểm tham quan lịch sử được đánh giá cao nhất Hà Nội, món "trà bàng lá nếp" tại quầy lưu niệm cũng thành hiện tượng.',
    imageQueries: ['Hoa Lo prison', 'Hanoi Hilton prison', 'Maison Centrale Hanoi'],
  },
  'Bảo tàng Dân tộc học Việt Nam': {
    description:
      'Bảo tàng Dân tộc học Việt Nam là nơi lưu giữ và trưng bày sống động văn hóa của 54 dân tộc anh em, được nhiều tổ chức du lịch quốc tế xếp hạng bảo tàng hấp dẫn nhất Việt Nam. Tòa nhà Trống Đồng trưng bày 15.000 hiện vật theo từng nhóm ngôn ngữ - tộc người: trang phục, nhạc cụ, công cụ, nghi lễ vòng đời được chú giải khoa học và trực quan.\n\nĐiểm độc đáo nhất là khu vườn kiến trúc ngoài trời rộng 2ha với 10 công trình nguyên bản do chính người dân tộc dựng: nhà rông Bana cao vút, nhà dài Êđê, nhà sàn Tày, nhà mồ Giarai, nhà trình tường người Hà Nhì... Cuối tuần thường có múa rối nước và trình diễn nghề thủ công. Tòa nhà Cánh diều giới thiệu văn hóa các nước Đông Nam Á.',
    imageQueries: ['Vietnam Museum of Ethnology', 'Ethnology museum Hanoi', 'Rong house Bahnar'],
  },
  'Đền Ngọc Sơn - Hồ Hoàn Kiếm': {
    description:
      'Đền Ngọc Sơn tọa lạc trên đảo Ngọc giữa Hồ Hoàn Kiếm — trái tim của Hà Nội nghìn năm — là quần thể kiến trúc tâm linh biểu tượng của Thủ đô. Du khách qua cổng Tháp Bút khắc ba chữ "Tả Thanh Thiên" (viết lên trời xanh), Đài Nghiên, rồi bước trên cầu Thê Húc sơn đỏ cong cong "đón ánh sáng ban mai" để vào đền thờ Đức thánh Trần Hưng Đạo và thần Văn Xương.\n\nTrong đền trưng bày tiêu bản cụ rùa Hồ Gươm khổng lồ gắn với truyền thuyết vua Lê Lợi trả gươm thần. Từ đền nhìn ra Tháp Rùa cổ kính giữa làn nước xanh lục thủy. Khu vực quanh hồ là phố đi bộ cuối tuần nhộn nhịp, gần phố cổ, đền Bà Kiệu, tượng đài Lý Thái Tổ — cụm tham quan không thể bỏ qua khi đến Hà Nội.',
    imageQueries: ['Ngoc Son temple', 'Hoan Kiem lake', 'The Huc bridge'],
  },
  'Vinpearl Safari Phú Quốc': {
    description:
      'Vinpearl Safari Phú Quốc là công viên chăm sóc và bảo tồn động vật bán hoang dã đầu tiên và lớn nhất Việt Nam với diện tích 380ha, nuôi dưỡng hơn 4.500 cá thể thuộc 200 loài từ khắp các châu lục, trong đó nhiều loài quý hiếm như hổ Bengal, sư tử trắng, tê giác, vượn cáo Madagascar, hồng hạc.\n\nTrải nghiệm độc đáo nhất là ngồi xe bus chuyên dụng xuyên qua khu Safari bán hoang dã — nơi "thú thả, người nhốt": hươu cao cổ ghé sát cửa sổ, đàn sư tử, hổ, gấu tự do ngay bên ngoài. Khu vườn thú mở có show giáo dục về động vật, khu cho hươu cao cổ ăn, vườn chim, khu linh trưởng. Công viên đạt chuẩn quốc tế về phúc trạng động vật, là điểm đến giáo dục tuyệt vời cho trẻ em.',
    imageQueries: ['Vinpearl Safari Phu Quoc', 'Safari Phu Quoc giraffe', 'Phu Quoc safari park'],
  },
  'Rừng tràm Trà Sư': {
    description:
      'Rừng tràm Trà Sư rộng 850ha là khu rừng ngập nước tiêu biểu nhất miền Tây sông Hậu, đẹp mê hoặc với thảm bèo tấm xanh ngắt phủ kín mặt nước như tấm thảm nhung khổng lồ. Du khách đi tắc ráng (xuồng máy) rồi chuyển sang xuồng ba lá chèo tay, lướt êm giữa hai hàng tràm cổ thụ rợp bóng, ngắm chim chao liệng — nơi đây là sân chim của hơn 70 loài, nhiều loài quý hiếm có tên trong sách đỏ.\n\nĐiểm nhấn còn có cây cầu tre xuyên rừng dài nhất Việt Nam (hơn 10km), lầu vọng cảnh ngắm toàn cảnh rừng tràm, và ẩm thực đặc sản mùa nước nổi: lẩu cá linh bông điên điển, gà nướng muối ớt. Đẹp nhất vào mùa nước nổi tháng 9–11, khi cả khu rừng ngập trong sắc xanh mướt mát.',
    imageQueries: ['Tra Su forest', 'Tra Su cajuput forest', 'Tra Su An Giang'],
  },
  'Khu du lịch Đồi cát bay Mũi Né': {
    description:
      'Đồi cát bay Mũi Né (đồi cát Hồng) là một trong những đồi cát đẹp nhất Việt Nam, nổi tiếng với khả năng "thay hình đổi dạng" liên tục theo gió — mỗi thời điểm trong ngày mang một dáng vẻ và sắc màu khác nhau, từ vàng óng, hồng cam đến đỏ sậm. Trải nghiệm thú vị nhất là thuê ván trượt cát lao từ triền dốc cao, chơi xe địa hình ATV hay jeep vượt đồi cát.\n\nThời điểm đẹp nhất là bình minh và hoàng hôn, khi ánh nắng nhuộm những đường cong mềm mại của cát thành bức tranh siêu thực — thiên đường của giới nhiếp ảnh. Gần đó có thể kết hợp tham quan Suối Tiên (suối cát đỏ), làng chài Mũi Né và Bàu Trắng với đồi cát trắng bên hồ sen — được ví như "tiểu sa mạc Sahara" của Việt Nam.',
    imageQueries: ['Mui Ne sand dunes', 'red sand dunes Mui Ne', 'Mui Ne Phan Thiet'],
  },
  'Khu du lịch Datanla': {
    description:
      'Thác Datanla là khu du lịch thác nước gắn với trò chơi mạo hiểm nổi tiếng nhất Đà Lạt, nằm giữa rừng thông trên đèo Prenn. Điểm hút khách số một là hệ thống máng trượt (alpine coaster) dài 2.400m — dài nhất Đông Nam Á — cho du khách tự điều khiển tốc độ lao xuyên rừng thông xuống chân thác, cảm giác phấn khích nhưng an toàn cho cả gia đình.\n\nThác chính cao hơn 20m đổ qua bảy tầng đá gắn với truyền thuyết các nàng tiên tắm suối ("Đạ Tam N\'ha" — nước dưới lá). Các hoạt động khác gồm đu dây vượt thác (canyoning) dành cho người ưa mạo hiểm, cáp treo ngắm thác, vòng xoay zorbing. Khu du lịch gần trung tâm Đà Lạt chỉ 5km, dễ kết hợp với hồ Tuyền Lâm và Thiền viện Trúc Lâm.',
    imageQueries: ['Datanla waterfall', 'Datanla Da Lat', 'Datanla alpine coaster'],
  },
  'Thung lũng Tình Yêu': {
    description:
      'Thung lũng Tình Yêu là khu du lịch lãng mạn bậc nhất Đà Lạt, cách trung tâm 5km, nơi thung lũng xanh mướt ôm trọn hồ Đa Thiện thơ mộng giữa những đồi thông trùng điệp. Từ thời Pháp nơi đây đã được gọi là "Vallée d\'Amour" — điểm hẹn hò của các đôi lứa với vô số tiểu cảnh: vườn hoa rực rỡ quanh năm, cầu khóa tình yêu, mê cung tình yêu bằng cây xanh khổng lồ.\n\nDu khách có thể đạp vịt trên hồ, đi xe ngựa, xe điện dạo quanh thung lũng, trượt cỏ, đu dây zipline hay chụp ảnh cùng những vườn hoa cẩm tú cầu, oải hương theo mùa. Khu du lịch liên thông với Đồi Mộng Mơ. Không khí se lạnh, mây mù buổi sớm và sắc hoa bốn mùa khiến nơi đây luôn nằm trong danh sách phải ghé khi đến thành phố ngàn hoa.',
    imageQueries: ['Valley of Love Da Lat', 'Thung lung Tinh Yeu', 'Da Lat flower garden'],
  },
  'Ga Đà Lạt': {
    description:
      'Ga Đà Lạt xây dựng năm 1932–1938 là nhà ga xe lửa cổ đẹp nhất Đông Dương còn lại đến nay, được công nhận di tích kiến trúc quốc gia. Công trình do hai kiến trúc sư người Pháp thiết kế với ba mái vòm nhọn cách điệu hình ba đỉnh núi Langbiang huyền thoại, kết hợp phong cách Art Deco với những ô cửa kính màu — biểu tượng kiến trúc độc đáo của thành phố sương mù.\n\nNơi đây từng là điểm cuối tuyến đường sắt răng cưa Tháp Chàm - Đà Lạt huyền thoại vượt độ cao 1.500m. Ngày nay du khách có thể trải nghiệm chuyến tàu cổ chạy tuyến Đà Lạt - Trại Mát dài 7km thăm chùa Linh Phước, chụp ảnh cùng đầu máy hơi nước cổ, toa tàu gỗ và quán cà phê trong toa xe lửa đầy hoài niệm.',
    imageQueries: ['Da Lat railway station', 'Dalat train station', 'Da Lat station heritage'],
  },
  'Cột cờ Lũng Cú': {
    description:
      'Cột cờ Lũng Cú đứng trên đỉnh núi Rồng (Long Sơn) ở độ cao 1.469m — điểm đánh dấu cực Bắc thiêng liêng của Tổ quốc, nơi lá cờ đỏ sao vàng rộng 54m² (tượng trưng 54 dân tộc) tung bay kiêu hãnh giữa cao nguyên đá Đồng Văn. Du khách chinh phục 839 bậc thang (hoặc xe điện một đoạn) lên chân cột cờ, rồi leo tiếp 140 bậc xoắn ốc trong lòng cột để chạm tay vào lá cờ Tổ quốc.\n\nTừ đỉnh cột cờ, toàn cảnh biên cương hùng vĩ mở ra: những dãy núi đá tai mèo trùng điệp, hai hồ nước "mắt rồng" không bao giờ cạn của bản Lô Lô Chải và Thèn Pả, ruộng bậc thang và đường biên giới Việt - Trung. Đây là điểm check-in thiêng liêng nhất trong hành trình khám phá Hà Giang — công viên địa chất toàn cầu UNESCO.',
    imageQueries: ['Lung Cu flag tower', 'Lung Cu Ha Giang', 'Dong Van karst plateau'],
  },
  'Thác Bản Giốc': {
    description:
      'Thác Bản Giốc là thác nước tự nhiên lớn nhất Đông Nam Á và nằm trong nhóm thác biên giới đẹp nhất thế giới, nơi dòng sông Quây Sơn xanh ngọc bích đổ xuống ba tầng thác trắng xóa rộng tới 300m giữa khung cảnh núi non trùng điệp vùng biên Cao Bằng. Tiếng thác đổ vang vọng cả vùng, hơi nước bay mờ ảo tạo cầu vồng lung linh những ngày nắng.\n\nDu khách đi bè tre ra sát chân thác cảm nhận sự hùng vĩ, chụp ảnh giữa đồng lúa và guồng nước của người Tày. Đẹp nhất vào tháng 9–10 khi nước đầy và lúa chín vàng hai bên bờ. Gần đó có động Ngườm Ngao kỳ ảo dài hơn 2km và chùa Phật Tích Trúc Lâm Bản Giốc — ngôi chùa nơi biên cương nhìn xuống toàn cảnh thác.',
    imageQueries: ['Ban Gioc waterfall', 'Ban Gioc Detian falls', 'Quay Son river Cao Bang'],
  },
  'Bản Cát Cát Sa Pa': {
    description:
      'Bản Cát Cát là ngôi làng cổ của người H\'Mông nằm dưới chân dãy Hoàng Liên Sơn, cách trung tâm Sa Pa chỉ 2km, được mệnh danh là "ngôi làng đẹp nhất Tây Bắc". Con đường đá dẫn xuống bản len qua những nếp nhà trình tường, ruộng bậc thang xanh mướt, vườn hoa rực rỡ và những guồng nước gỗ quay đều bên suối — khung cảnh đậm chất thơ của vùng cao.\n\nTrung tâm bản là thác Cát Cát (thác Tiên Sa) ào ạt quanh năm cùng cây cầu treo Si và A Lứ nổi tiếng. Du khách được xem người H\'Mông dệt thổ cẩm, nhuộm chàm, chế tác bạc truyền thống, thưởng thức thắng cố, cơm lam, và thuê trang phục dân tộc chụp ảnh. Buổi biểu diễn múa xòe, khèn H\'Mông tại nhà văn hóa diễn ra hàng ngày.',
    imageQueries: ['Cat Cat village', 'Cat Cat Sapa', 'Sapa Hmong village'],
  },
  'Đảo Cát Bà - Vịnh Lan Hạ': {
    description:
      'Cát Bà là đảo lớn nhất vịnh Bắc Bộ với vườn quốc gia — khu dự trữ sinh quyển thế giới UNESCO, còn vịnh Lan Hạ kề bên được ví như "Hạ Long thu nhỏ" hoang sơ hơn với 400 hòn đảo đá vôi và 139 bãi cát nhỏ xinh, làn nước trong vắt. Năm 2023, quần thể Hạ Long - Cát Bà chính thức trở thành di sản thiên nhiên thế giới liên tỉnh đầu tiên của Việt Nam.\n\nTour vịnh Lan Hạ đưa du khách chèo kayak xuyên hang Sáng - hang Tối, tắm biển đảo Khỉ, lặn ngắm san hô, thăm làng chài Cái Bèo cổ nhất Việt Nam. Trên đảo có thể chinh phục đỉnh Ngự Lâm trong vườn quốc gia, pháo đài Thần Công ngắm hoàng hôn, hay tắm tại ba bãi Cát Cò. Hải sản tươi sống và những resort ven vịnh hoàn thiện chuyến nghỉ dưỡng biển đảo trọn vẹn.',
    imageQueries: ['Lan Ha bay', 'Cat Ba island', 'Cat Ba Vietnam'],
  },
  'Chùa Hương': {
    description:
      'Chùa Hương (Hương Sơn) là quần thể văn hóa - tâm linh lớn bậc nhất miền Bắc với hàng chục ngôi chùa, đền, đình rải rác trong thung lũng núi đá vôi huyện Mỹ Đức, Hà Nội. Hành trình kinh điển bắt đầu bằng chuyến đò trên suối Yến thơ mộng giữa hai dãy núi trùng điệp (mùa thu có hoa súng nở tím mặt nước), qua đền Trình, chùa Thiên Trù — "bếp trời" với kiến trúc bề thế.\n\nĐiểm thiêng liêng nhất là động Hương Tích — "Nam thiên đệ nhất động" — nơi chúa Trịnh Sâm đề bút, trong động có chùa Hương Tích thờ Phật Bà Quan Âm cùng các nhũ đá Đụn Gạo, Cây Vàng, Cây Bạc gắn với tín ngưỡng cầu tài lộc, con cái. Có cáp treo lên động cho người ngại leo núi. Lễ hội chùa Hương từ mùng 6 tháng Giêng đến hết tháng 3 âm lịch là lễ hội dài nhất Việt Nam.',
    imageQueries: ['Perfume Pagoda', 'Huong pagoda Vietnam', 'Yen stream Perfume pagoda'],
  },
  'Hang Múa': {
    description:
      'Hang Múa nằm dưới chân núi Múa ở Ninh Bình, nổi tiếng toàn cầu nhờ đỉnh vọng cảnh được mệnh danh "nấc thang lên thiên đường" — sau khi chinh phục gần 500 bậc đá theo kiến trúc tựa Vạn Lý Trường Thành, du khách được đền đáp bằng tầm nhìn ngoạn mục nhất Ninh Bình: toàn cảnh Tam Cốc với sông Ngô Đồng uốn lượn giữa cánh đồng lúa và núi đá vôi trùng điệp.\n\nTrên đỉnh là tháp đá với tượng rồng đá uy nghi và am thờ Quan Âm. Dưới chân núi có hang Múa — nơi vua Trần xưa thưởng thức múa hát, đầm sen nở rộ mùa hè (điểm chụp ảnh cực đẹp), vườn hoa và khu nghỉ dưỡng Mua Caves Ecolodge. Đẹp nhất vào mùa lúa chín tháng 5–6 và bình minh hoặc hoàng hôn khi ánh sáng nhuộm vàng cả thung lũng.',
    imageQueries: [
      'Mua cave Ninh Binh',
      'Hang Mua viewpoint',
      'Hang Mua',
      'Ngo Dong river viewpoint',
      'Tam Coc panorama Ninh Binh',
    ],
  },
  'Cù Lao Chàm': {
    description:
      'Cù Lao Chàm là cụm 8 hòn đảo hoang sơ cách Hội An 15km — khu dự trữ sinh quyển thế giới UNESCO với hệ sinh thái biển phong phú bậc nhất miền Trung: hơn 300ha rạn san hô, thảm cỏ biển cùng hàng trăm loài cá, là nơi tiên phong nói không với túi nilon của Việt Nam. Cano cao tốc từ Cửa Đại chỉ mất 20 phút ra đảo.\n\nTour trong ngày gồm lặn ngắm san hô bằng ống thở (hoặc đi bộ dưới đáy biển), tắm tại Bãi Chồng, Bãi Ông cát trắng nước trong, thăm chùa Hải Tạng cổ gần 300 năm, giếng cổ Chăm nghìn năm không cạn, chợ hải sản Bãi Làng và miếu thờ tổ nghề yến. Đặc sản nổi tiếng có cua đá, ốc vú nàng, mực một nắng và rau rừng. Biển đẹp nhất từ tháng 3 đến tháng 8.',
    imageQueries: ['Cu Lao Cham', 'Cham islands Hoi An', 'Cu Lao Cham beach'],
  },
  'Tháp Bà Ponagar': {
    description:
      'Tháp Bà Ponagar là quần thể đền tháp Chăm Pa được bảo tồn tốt bậc nhất Việt Nam, xây dựng từ thế kỷ 8–13 trên đồi Cù Lao bên cửa sông Cái, thờ nữ thần Po Inư Nagar — Thiên Y A Na Thánh Mẫu, người Mẹ xứ sở dạy dân trồng lúa, dệt vải. Tháp chính cao 23m là kiệt tác kiến trúc gạch nung Chăm với tượng nữ thần bằng đá đen ngồi trên đài sen.\n\nDi tích còn khu tiền đình Mandapa với hàng cột gạch bát giác độc đáo. Hàng ngày có biểu diễn múa Chăm, múa đội nước duyên dáng cùng nhạc cụ truyền thống. Từ đồi tháp, du khách ngắm trọn cảnh cầu Xóm Bóng và đoàn thuyền đánh cá sông Cái. Lễ hội Tháp Bà tháng 3 âm lịch là lễ hội văn hóa Chăm lớn nhất Nam Trung Bộ.',
    imageQueries: ['Po Nagar tower', 'Ponagar Nha Trang', 'Po Nagar Cham temple'],
  },
  'Gành Đá Đĩa': {
    description:
      'Gành Đá Đĩa là kỳ quan địa chất độc nhất vô nhị của Việt Nam — bãi đá bazan hình lục giác xếp khít nhau như hàng vạn chiếc đĩa khổng lồ chồng nghiêng ra biển, hình thành từ dung nham núi lửa phun trào hàng triệu năm trước gặp nước biển nguội lạnh nứt thành khối trụ đều tăm tắp. Hiện tượng tương tự chỉ có ở vài nơi trên thế giới như Giant\'s Causeway (Ireland).\n\nDanh thắng quốc gia đặc biệt này đẹp nhất lúc bình minh khi nắng sớm nhuộm vàng các trụ đá đen bóng bên làn sóng trắng xóa. Du khách có thể kết hợp tham quan ngọn hải đăng Gành Đèn đỏ trắng gần đó, bãi Bàng nước trong xanh, và thưởng thức đặc sản Phú Yên: mắt cá ngừ đại dương, sò huyết đầm Ô Loan trên đường về.',
    imageQueries: ['Ganh Da Dia', 'Da Dia reef Phu Yen', 'Ganh Da Dia Phu Yen'],
  },
  'Kỳ Co - Eo Gió': {
    description:
      'Kỳ Co - Eo Gió là cặp danh thắng biển nổi tiếng nhất Quy Nhơn trên bán đảo Phương Mai. Bãi Kỳ Co được ví như "Maldives của Việt Nam" với làn nước hai màu xanh ngọc trong vắt nhìn thấu đáy, bãi cát vàng mịn được núi đá ôm trọn ba mặt — du khách ra bãi bằng cano cao tốc vượt biển hoặc đường bộ men vách núi đầy phấn khích.\n\nCách đó vài km, Eo Gió là eo biển hình vòng cung được mệnh danh "nơi ngắm hoàng hôn đẹp nhất Việt Nam" với con đường đi bộ ven vách đá trắng hùng vĩ, nước biển xanh thẳm và những rạn đá nhấp nhô sóng vỗ. Tour thường kết hợp lặn ngắm san hô tại Bãi Dứa, thưởng thức hải sản tươi và ghé Tịnh xá Ngọc Hòa với tượng Phật đôi cao nhất Việt Nam.',
    imageQueries: ['Ky Co beach', 'Eo Gio Quy Nhon', 'Ky Co Quy Nhon'],
  },
  'Bảo tàng Quang Trung': {
    description:
      'Bảo tàng Quang Trung tọa lạc ngay trên quê hương của ba anh em nhà Tây Sơn tại Bình Định, là nơi lưu giữ và tôn vinh sự nghiệp hiển hách của Hoàng đế Quang Trung - Nguyễn Huệ, thiên tài quân sự bách chiến bách thắng với đỉnh cao là đại phá 29 vạn quân Thanh mùa xuân Kỷ Dậu 1789. Bảo tàng trưng bày hơn 11.000 hiện vật: ấn tín, vũ khí, trống trận, chiếu chỉ thời Tây Sơn.\n\nTrong khuôn viên có điện thờ Tây Sơn Tam Kiệt với cây me cổ thụ hơn 200 năm và giếng nước đá ong của gia đình họ Nguyễn — di tích gốc quý giá. Điểm đặc sắc nhất là chương trình biểu diễn nhạc võ Tây Sơn với trống trận 12 trống hào hùng và võ thuật Bình Định truyền thống — tinh hoa "miền đất võ".',
    imageQueries: ['Quang Trung museum', 'Tay Son Binh Dinh', 'Quang Trung museum Binh Dinh'],
  },
  'Chợ nổi Cái Răng': {
    description:
      'Chợ nổi Cái Răng là chợ nổi lớn và sầm uất nhất miền Tây Nam Bộ — di sản văn hóa phi vật thể quốc gia, nơi hàng trăm ghe thuyền tụ họp buôn bán nông sản trên sông từ tờ mờ sáng. Nét độc đáo trăm năm là "cây bẹo": mỗi ghe treo loại nông sản mình bán lên cây sào cao để khách nhận biết từ xa — hình thức quảng cáo dân dã có một không hai.\n\nDu khách xuất phát từ bến Ninh Kiều lúc 5–6 giờ sáng để kịp đón bình minh trên sông Hậu và không khí họp chợ nhộn nhịp nhất, trải nghiệm ăn sáng ngay trên ghe: tô hủ tiếu, bún riêu, ly cà phê kho chòng chành sóng nước, mua trái cây miệt vườn tươi rói. Tour thường kết hợp thăm lò hủ tiếu truyền thống và vườn trái cây ven sông.',
    imageQueries: ['Cai Rang floating market', 'Can Tho floating market', 'Mekong floating market'],
  },
  'Cáp treo Núi Cấm': {
    description:
      'Núi Cấm (Thiên Cấm Sơn) cao 705m là ngọn núi cao và linh thiêng nhất dãy Thất Sơn huyền bí của An Giang, được mệnh danh "Đà Lạt của miền Tây" nhờ khí hậu mát mẻ quanh năm. Tuyến cáp treo dài 3.461m đưa du khách lướt trên những cánh rừng xanh thẳm và hồ Thanh Long, ngắm toàn cảnh đồng bằng châu thổ trải dài tới biên giới.\n\nTrên đỉnh núi là quần thể tâm linh nổi tiếng: tượng Phật Di Lặc cao 33,6m từng đạt kỷ lục châu Á về tượng Phật trên đỉnh núi, chùa Vạn Linh với bảo tháp soi bóng hồ Thủy Liêm thơ mộng, chùa Phật Lớn trăm năm tuổi. Du khách thưởng thức đặc sản bánh xèo rau núi với hàng chục loại rau rừng hái quanh núi — món ăn nhất định phải thử.',
    imageQueries: ['Nui Cam An Giang', 'Cam mountain Vietnam', 'That Son An Giang'],
  },
  'Đất Mũi Cà Mau': {
    description:
      'Đất Mũi Cà Mau là điểm cực Nam thiêng liêng của Tổ quốc — nơi "đất biết nở, rừng biết đi và biển sinh sôi" với bãi bồi lấn biển hàng chục mét mỗi năm, và là nơi duy nhất trên đất liền Việt Nam có thể ngắm mặt trời mọc ở biển Đông và lặn ở biển Tây. Các biểu tượng check-in thiêng liêng gồm: mốc tọa độ quốc gia GPS 0001, tiểu cảnh con tàu mũi đất vươn khơi, cột cờ Hà Nội tại Cà Mau và biểu tượng điểm cuối đường Hồ Chí Minh.\n\nDu khách đi cầu gỗ xuyên rừng đước nguyên sinh — khu dự trữ sinh quyển thế giới, ngắm hệ sinh thái ngập mặn độc đáo từ tháp quan sát, trải nghiệm xuồng máy len lỏi kênh rạch và thưởng thức đặc sản ba khía, cua Cà Mau, cá thòi lòi nướng muối ớt trứ danh.',
    imageQueries: ['Ca Mau cape', 'Dat Mui Ca Mau', 'Ca Mau mangrove'],
  },
  'Cáp treo Hồ Mây Vũng Tàu': {
    description:
      'Hồ Mây Park là khu du lịch tổng hợp trên đỉnh Núi Lớn cao 210m — nơi duy nhất ở Vũng Tàu có cáp treo, đưa du khách từ chân núi đường Trần Phú lên đỉnh trong vài phút với tầm nhìn toàn cảnh thành phố biển, Bãi Trước cong cong và những đoàn tàu neo đậu ngoài khơi tuyệt đẹp.\n\nTrên đỉnh núi mát mẻ là công viên rộng 50ha với hơn 50 trò chơi và hoạt động: máng trượt núi, đu dây zipline, thác nước nhân tạo, hồ Mây thơ mộng giữa rừng thông, khu trò chơi cảm giác mạnh, vườn thú, vườn hoa, rạp phim 5D và khu tâm linh với tượng Phật Di Lặc, Quan Âm. Vé cáp treo trọn gói bao gồm hầu hết trò chơi, thích hợp cho gia đình vui chơi cả ngày và ngắm hoàng hôn trên biển Vũng Tàu.',
    imageQueries: ['Ho May park Vung Tau', 'Vung Tau cable car', 'Nui Lon Vung Tau'],
  },
  'Khu du lịch Bửu Long': {
    description:
      'Khu du lịch Bửu Long rộng 84ha được mệnh danh là "Vịnh Hạ Long thu nhỏ" của Đông Nam Bộ, với hồ Long Ẩn nước xanh ngọc bích rộng hàng chục hecta được hình thành từ việc khai thác đá hàng trăm năm, nay là thắng cảnh với những vách đá sừng sững soi bóng mặt hồ và các hòn đảo nhỏ nên thơ.\n\nTrong khu du lịch có núi Bửu Long với chùa cổ Bửu Phong gần 400 năm trên đỉnh, Văn miếu Trấn Biên — văn miếu đầu tiên của vùng đất phương Nam ngay kề bên. Du khách có thể đạp vịt, chèo thuyền kayak trên hồ, cắm trại picnic dưới tán cây xanh, check-in các tiểu cảnh và khu vui chơi trẻ em. Cách TP.HCM chỉ 30km, đây là điểm dã ngoại cuối tuần lý tưởng cho gia đình.',
    imageQueries: ['Buu Long Bien Hoa', 'Buu Long park Dong Nai', 'Long An lake Buu Long'],
  },
  'Grand World Phú Quốc': {
    description:
      'Grand World Phú Quốc — "thành phố không ngủ" của đảo ngọc — là tổ hợp giải trí, mua sắm hoạt động 24/7 với kiến trúc lấy cảm hứng từ Venice (Ý), nơi du khách ngồi thuyền gondola trên dòng kênh đào uốn lượn giữa những dãy phố mua sắm rực rỡ sắc màu. Hoàn toàn miễn phí vào cửa, chỉ trả phí cho từng trải nghiệm.\n\nĐiểm nhấn ấn tượng: Bamboo Legend — công trình tre lớn nhất Việt Nam với 32.000 cây tre như tác phẩm nghệ thuật khổng lồ, show diễn "Tinh hoa Việt Nam" tái hiện văn hóa Việt với 200 diễn viên trên sân khấu thực cảnh, show nhạc nước hiện đại "Sắc màu Venice" hàng đêm, khu phố đêm sôi động, công viên gấu Teddy Bear Museum và Bảo tàng tranh 3D. Nằm cạnh VinWonders và Casino Corona, tiện kết hợp cả cụm Bắc đảo.',
    imageQueries: ['Grand World Phu Quoc', 'Phu Quoc Venice canal', 'Bamboo Legend Phu Quoc'],
  },
  'Khu di tích Chiến trường Điện Biên Phủ (Đồi A1)': {
    description:
      'Khu di tích Chiến trường Điện Biên Phủ là cụm di tích quốc gia đặc biệt ghi dấu chiến thắng "lừng lẫy năm châu, chấn động địa cầu" ngày 7/5/1954 kết thúc cuộc kháng chiến chống Pháp. Đồi A1 là cứ điểm ác liệt nhất với xác xe tăng, hố bộc phá gần 1.000kg và đường hầm lịch sử; gần đó là hầm Đờ Cát (De Castries) — sở chỉ huy tập đoàn cứ điểm bị bắt sống nguyên vẹn.\n\nBảo tàng Chiến thắng lịch sử Điện Biên Phủ trưng bày hàng nghìn hiện vật cùng bức tranh panorama tái hiện toàn cảnh chiến dịch dài 132m — tác phẩm hội họa hoành tráng bậc nhất Việt Nam. Du khách có thể kết hợp thăm tượng đài Chiến thắng trên đồi D1 và nghĩa trang liệt sĩ A1 để hiểu trọn giá trị lịch sử của mảnh đất Điện Biên.',
    imageQueries: ['Dien Bien Phu Victory Museum', 'A1 Hill Dien Bien Phu', 'Dien Bien Phu battlefield'],
  },
  'Thác Dải Yếm Mộc Châu': {
    description:
      'Thác Dải Yếm nằm giữa cao nguyên Mộc Châu, được ví như dải lụa mềm vắt ngang núi rừng Tây Bắc. Thác gồm hai tầng đổ từ độ cao khoảng 100m, mùa nước (tháng 4 đến tháng 10) tung bọt trắng xóa hùng vĩ, mùa khô lại hiền hòa thơ mộng bên những đồi cỏ xanh mướt.\n\nKhu du lịch quanh thác có cầu kính tình yêu, cầu gỗ, đồng hoa và các tiểu cảnh check-in nổi tiếng thu hút giới trẻ. Kết hợp với đồi chè trái tim, rừng thông bản Áng và các bản người Thái, Mông lân cận, thác Dải Yếm là điểm dừng chân không thể bỏ qua trong hành trình khám phá Mộc Châu.',
    imageQueries: ['Thác Dải Yếm', 'Dai Yem Waterfall', 'Waterfalls in Sơn La Province', 'Mộc Châu'],
  },
  'Ruộng bậc thang Mù Cang Chải (Đồi Mâm Xôi)': {
    description:
      'Ruộng bậc thang Mù Cang Chải là danh thắng quốc gia trải rộng trên các xã La Pán Tẩn, Chế Cu Nha, Dế Xu Phình, được kiến tạo qua nhiều đời bởi bàn tay người Mông. Vào mùa lúa chín cuối tháng 9 đầu tháng 10, cả vùng núi nhuộm vàng óng như những bậc thang khổng lồ nối đất với trời — một trong những cảnh quan ruộng bậc thang đẹp nhất thế giới.\n\nBiểu tượng nổi tiếng nhất là đồi Mâm Xôi ở La Pán Tẩn với những vòng ruộng tròn xoáy độc đáo, cùng đồi Móng Ngựa gần đó. Ngoài mùa lúa chín, mùa nước đổ tháng 5–6 khi ruộng loang loáng phản chiếu trời mây cũng rất quyến rũ. Du khách có thể trekking, đi xe máy chinh phục đèo Khau Phạ và trải nghiệm dù lượn ngắm thung lũng vàng.',
    imageQueries: ['Mu Cang Chai terraced fields', 'Mam Xoi hill Mu Cang Chai', 'Mu Cang Chai rice terraces'],
  },
  'Hồ Ba Bể': {
    description:
      'Hồ Ba Bể là hồ nước ngọt tự nhiên trên núi lớn nhất Việt Nam, nằm trong Vườn quốc gia Ba Bể — khu Ramsar và di tích quốc gia đặc biệt. Mặt hồ rộng khoảng 500ha, sâu trung bình 20m, được bao bọc bởi những dãy núi đá vôi và rừng nguyên sinh, quanh năm phẳng lặng in bóng mây trời.\n\nDu khách khám phá hồ bằng thuyền độc mộc hoặc xuồng máy, ghé đảo Bà Góa, đảo An Mã, chui qua động Puông dài 300m nơi đàn dơi trú ngụ, ngắm thác Đầu Đẳng và ao Tiên huyền bí. Kết hợp lưu trú homestay tại bản người Tày Pác Ngòi, thưởng thức ẩm thực địa phương và nghe hát then đàn tính, Ba Bể là điểm đến sinh thái yên bình bậc nhất vùng Đông Bắc.',
    imageQueries: ['Ba Be Lake', 'Ba Be National Park', 'Puong cave Ba Be'],
  },
  'Động Tam Thanh Lạng Sơn': {
    description:
      'Động Tam Thanh là danh thắng nổi tiếng nhất xứ Lạng, được xếp vào hàng "Đệ nhất bát cảnh". Trong lòng núi là chùa Tam Thanh cổ kính với hệ thống tượng Phật tạc trong hang, hồ Âm Ti nước trong xanh quanh năm và những khối nhũ đá kỳ ảo cùng "cửa trời" đón ánh sáng tự nhiên.\n\nTừ cửa động, du khách có thể ngắm nàng Tô Thị bồng con hóa đá trên đỉnh núi — hình tượng gắn với câu ca dao quen thuộc về lòng chung thủy. Cụm di tích còn có thành nhà Mạc rêu phong và gần trung tâm thành phố nên rất tiện kết hợp tham quan chợ Kỳ Lừa, ải Chi Lăng và thưởng thức ẩm thực Lạng Sơn.',
    imageQueries: ['Tam Thanh cave Lang Son', 'Tam Thanh pagoda', 'Lang Son cave'],
  },
  'Khu di tích lịch sử Đền Hùng': {
    description:
      'Khu di tích lịch sử Đền Hùng trên núi Nghĩa Lĩnh là nơi thờ tự các Vua Hùng — những vị vua khai sinh dân tộc Việt, gắn với tín ngưỡng thờ cúng Hùng Vương được UNESCO ghi danh di sản văn hóa phi vật thể. Quần thể gồm đền Hạ, đền Trung, đền Thượng và lăng Vua Hùng nối nhau theo bậc đá lên đỉnh núi giữa rừng cây cổ thụ.\n\nDưới chân núi là đền Giếng, bảo tàng Hùng Vương và đền Mẫu Âu Cơ trên núi Vặn. Hằng năm vào ngày 10 tháng 3 âm lịch, hàng vạn người dân cả nước hành hương về đây dự Giỗ Tổ. Không gian linh thiêng, cây xanh mát và các công trình cổ kính khiến Đền Hùng vừa là điểm tâm linh, vừa là nơi giáo dục truyền thống "uống nước nhớ nguồn".',
    imageQueries: ['Hung Kings Temple', 'Den Hung Phu Tho', 'Nghia Linh mountain temple'],
  },
  'Cáp treo Tây Thiên': {
    description:
      'Cáp treo Tây Thiên đưa du khách vượt núi rừng Tam Đảo lên quần thể danh thắng — tâm linh Tây Thiên, một trong những trung tâm Phật giáo và tín ngưỡng thờ Mẫu lâu đời của Việt Nam. Trong hành trình cáp treo, du khách ngắm suối Giải Oan, rừng nguyên sinh và thác nước ẩn hiện giữa mây núi.\n\nĐiểm đến gồm đền Thượng thờ Quốc Mẫu Tây Thiên Lăng Thị Tiêu, đền Cậu, đền Cô, Thiền viện Trúc Lâm Tây Thiên và Đại bảo tháp Mandala uy nghi. Kết hợp cáp treo và đi bộ, du khách vừa hành hương lễ Phật, lễ Mẫu vừa tận hưởng không khí mát lành của vùng núi Tam Đảo chỉ cách Hà Nội khoảng 65km.',
    imageQueries: ['Tay Thien Tam Dao', 'Tay Thien cable car', 'Truc Lam Tay Thien monastery'],
  },
  'Khu du lịch Tam Chúc': {
    description:
      'Khu du lịch Tam Chúc là quần thể chùa rộng lớn bậc nhất thế giới, tựa lưng vào núi Thất Tinh, mặt hướng hồ Lục Nhạc với sáu hòn đảo đá nhô lên mặt nước — khung cảnh sơn thủy hữu tình được ví như "vịnh Hạ Long trên cạn". Du khách di chuyển bằng thuyền qua hồ hoặc xe điện để vào khu chùa.\n\nCác công trình chính gồm cổng Tam Quan, Vườn Cột Kinh với 32 cột đá khổng lồ, điện Quán Âm, điện Pháp Chủ đặt tượng Phật bằng đồng nặng 150 tấn, điện Tam Thế và chùa Ngọc trên đỉnh núi. Không gian rộng lớn, kiến trúc bề thế cùng hàng nghìn bức phù điêu đá tạc tích nhà Phật khiến Tam Chúc trở thành điểm hành hương và tham quan ấn tượng của Hà Nam.',
    imageQueries: ['Chùa Tam Chúc', 'Tam Chúc', 'Tam Chuc Pagoda', 'Ba Sao Kim Bảng'],
  },
  'Thành nhà Hồ': {
    description:
      'Thành nhà Hồ (thành Tây Đô) là tòa thành đá độc đáo do Hồ Quý Ly cho xây dựng năm 1397, được UNESCO công nhận di sản văn hóa thế giới — một trong số ít thành đá còn lại ở Đông Nam Á. Thành được ghép từ những khối đá xanh khổng lồ nặng hàng chục tấn, xếp khít mà không cần chất kết dính, tồn tại vững chãi hơn sáu thế kỷ.\n\nNổi bật là bốn cổng thành vòm cuốn theo bốn hướng, trong đó cổng Nam là công trình đá lớn và đẹp nhất. Khu vực còn lưu giữ nền móng cung điện, đôi rồng đá thời Trần - Hồ và nhà trưng bày hiện vật khảo cổ. Thành nhà Hồ là minh chứng cho trình độ kiến trúc, kỹ thuật xây dựng đỉnh cao của người Việt cuối thế kỷ 14.',
    imageQueries: ['Ho Citadel', 'Thanh nha Ho Thanh Hoa', 'Ho Dynasty Citadel gate'],
  },
  'Khu di tích Kim Liên (Quê Bác)': {
    description:
      'Khu di tích Kim Liên là quê hương của Chủ tịch Hồ Chí Minh, một trong những di tích quốc gia đặc biệt được nhiều người dân cả nước về thăm nhất. Nơi đây gồm làng Hoàng Trù — quê ngoại, nơi Bác cất tiếng khóc chào đời, và làng Sen — quê nội, với những ngôi nhà tranh vách nứa mộc mạc lưu giữ kỷ vật tuổi thơ của Người.\n\nDu khách đi giữa những hàng cây, giếng Cốc, lò rèn, ao sen và nghe thuyết minh về thời niên thiếu của Bác trong không gian làng quê Nghệ An bình dị. Khu di tích còn có nhà tưởng niệm, khu mộ bà Hoàng Thị Loan trên núi Động Tranh, tạo nên hành trình về nguồn đầy xúc động và ý nghĩa giáo dục.',
    imageQueries: ['Làng Sen Kim Liên', 'Khu di tích Kim Liên', 'Hoàng Trù', 'Kim Lien Nam Dan'],
  },
  'Địa đạo Vịnh Mốc': {
    description:
      'Địa đạo Vịnh Mốc là hệ thống đường hầm ven biển Quảng Trị được người dân Vĩnh Linh đào trong những năm bom đạn ác liệt, trở thành ngôi làng dưới lòng đất giúp cả cộng đồng sinh sống và trụ vững ngay trên tuyến lửa. Địa đạo dài gần 2km với ba tầng sâu, được bảo tồn gần như nguyên vẹn.\n\nTrong lòng đất có hội trường, trạm xá, giếng nước, kho gạo và hàng chục hầm gia đình; đặc biệt có căn hầm hộ sinh nơi 17 em bé đã chào đời an toàn. Cửa hầm mở ra biển Cửa Tùng, giúp tiếp tế và cơ động. Tham quan Vịnh Mốc cùng nhà trưng bày, du khách cảm nhận sâu sắc sức sống mãnh liệt và ý chí kiên cường của con người vùng giới tuyến.',
    imageQueries: ['Vinh Moc tunnels', 'Vinh Moc Quang Tri', 'Vinh Moc tunnel entrance'],
  },
  'Đảo Lý Sơn': {
    description:
      'Đảo Lý Sơn là huyện đảo tiền tiêu của Quảng Ngãi, được hình thành từ hoạt động phun trào núi lửa hàng triệu năm trước, để lại cảnh quan địa chất độc đáo. Nổi tiếng là "vương quốc tỏi", đảo có những cánh đồng tỏi trên nền cát trắng và đá bazan cùng làn nước biển trong xanh.\n\nCác điểm không thể bỏ qua gồm miệng núi lửa Thới Lới, cổng Tò Vò được sóng biển bào mòn tạo hình vòm đá tự nhiên, chùa Hang, chùa Đục, Hang Câu và đảo Bé (An Bình) với bãi tắm hoang sơ. Lý Sơn còn gắn với di sản Hải đội Hoàng Sa qua Âm Linh Tự và lễ khao lề thế lính, mang giá trị lịch sử về chủ quyền biển đảo thiêng liêng.',
    imageQueries: ['Ly Son island', 'Ly Son Quang Ngai', 'To Vo gate Ly Son'],
  },
  'Thác Dray Nur': {
    description:
      'Thác Dray Nur là một trong những thác nước hùng vĩ nhất Tây Nguyên, nằm trên dòng sông Sêrêpốk huyền thoại. Với chiều rộng khoảng 250m và cao hơn 30m, dòng thác tung bọt trắng xóa quanh năm, gắn với truyền thuyết tình yêu bi tráng của người Ê Đê nên còn gọi là "thác Vợ".\n\nPhía sau màn nước là hang động rộng có thể chui vào ngắm thác từ bên trong — trải nghiệm độc đáo hiếm có. Khu vực quanh thác có cầu treo, vườn cây và lối mòn khám phá rừng, kết nối với thác Dray Sáp bên kia sông. Cảnh quan hoang sơ, khí hậu mát mẻ khiến Dray Nur là điểm đến hấp dẫn khi khám phá cao nguyên Đắk Lắk.',
    imageQueries: ['Thác Dray Nur', 'Dray Nur Waterfall', 'Dray Nur', 'Serepok waterfall'],
  },
  'Vịnh Vĩnh Hy': {
    description:
      'Vịnh Vĩnh Hy được xếp vào nhóm những vịnh biển đẹp nhất Việt Nam, nằm bên Vườn quốc gia Núi Chúa — khu dự trữ sinh quyển thế giới. Vịnh có làn nước trong xanh, bao quanh là những dãy núi đá và rừng khô hạn đặc trưng của vùng Ninh Thuận đầy nắng gió.\n\nDu khách đi tàu đáy kính ngắm rạn san hô rực rỡ, lặn biển, tắm ở các bãi hoang sơ như bãi Kê, hang Rái với các bãi đá san hô cổ độc đáo. Cung đường ven biển từ Vĩnh Hy đến vịnh còn được mệnh danh là một trong những cung đường ven biển đẹp nhất nước, lý tưởng cho hành trình khám phá và chụp ảnh.',
    imageQueries: ['Vinh Hy bay', 'Nui Chua National Park', 'Vinh Hy Ninh Thuan'],
  },
  'Khu du lịch Cồn Phụng': {
    description:
      'Khu du lịch Cồn Phụng là cù lao xanh mát trên sông Tiền, gắn với di tích của "đạo Dừa" do ông Nguyễn Thành Nam lập nên từ giữa thế kỷ 20, còn lưu lại sân Rồng, tháp Hòa Bình và những công trình kiến trúc kỳ lạ mang màu sắc tôn giáo riêng biệt.\n\nĐến Cồn Phụng, du khách trải nghiệm trọn vẹn văn hóa miệt vườn Bến Tre: đi xuồng ba lá luồn rạch dừa nước, xem làm kẹo dừa, đồ thủ công mỹ nghệ từ dừa, thưởng thức trái cây, mật ong và nghe đờn ca tài tử Nam Bộ. Không gian sông nước bình yên, gần gũi thiên nhiên khiến nơi đây là điểm dừng chân yêu thích khi về xứ dừa.',
    imageQueries: ['Con Phung Ben Tre', 'Ben Tre coconut', 'Mekong delta Ben Tre'],
  },
  'Vườn quốc gia Tràm Chim': {
    description:
      'Vườn quốc gia Tràm Chim là khu Ramsar giữa vùng Đồng Tháp Mười, thu nhỏ hệ sinh thái đất ngập nước đặc trưng của đồng bằng sông Cửu Long với rừng tràm, đồng cỏ năng, lung sen súng và các bàu nước mênh mông. Nơi đây là mái nhà của hàng trăm loài chim, trong đó quý hiếm nhất là sếu đầu đỏ.\n\nDu khách đi tắc ráng hoặc xuồng máy len qua các kênh rạch, ngắm chim làm tổ, cò trắng bay rợp trời và những cánh đồng sen, súng nở rực rỡ. Mùa nước nổi (khoảng tháng 9 đến tháng 11) là thời điểm đẹp nhất để trải nghiệm và tham gia các hoạt động dân dã như đặt lợp, hái bông súng, thưởng thức ẩm thực đồng quê miền Tây.',
    imageQueries: ['Tram Chim National Park', 'Dong Thap Muoi', 'red-crowned crane Tram Chim'],
  },
  'Nhà Công tử Bạc Liêu': {
    description:
      'Nhà Công tử Bạc Liêu là dinh thự bề thế xây dựng đầu thế kỷ 20, gắn với giai thoại về Trần Trinh Huy — vị công tử giàu có, ăn chơi khét tiếng Nam Kỳ lục tỉnh với câu nói lưu truyền "đốt tiền nấu trứng". Ngôi nhà mang phong cách kiến trúc Pháp sang trọng, vật liệu và nội thất phần lớn nhập từ Pháp.\n\nBên trong còn lưu giữ nhiều đồ nội thất cổ, bộ trường kỷ, giường, sập gụ khảm xà cừ tinh xảo cùng những câu chuyện về gia tộc họ Trần một thời vàng son. Nằm ngay trung tâm thành phố Bạc Liêu, ngôi nhà là điểm tham quan hấp dẫn, tiện kết hợp với khu lưu niệm nhạc sĩ Cao Văn Lầu và cánh đồng điện gió.',
    imageQueries: ['Nhà Công tử Bạc Liêu', 'Công tử Bạc Liêu', 'Nhà cổ Bạc Liêu', 'Bac Lieu'],
  },
  'Cầu kính Bạch Long Mộc Châu': {
    description:
      'Cầu kính Bạch Long tại Mộc Châu từng được ghi nhận là cầu kính đi bộ dài nhất thế giới, bắc qua vách núi ở độ cao hàng trăm mét so với thung lũng. Mặt cầu bằng kính trong suốt nhiều lớp, mang lại cảm giác như đang bước đi giữa không trung với tầm nhìn thẳng xuống vực sâu và núi rừng Tây Bắc trùng điệp.\n\nHành trình đến cầu đi qua thang máy lồng kính và đường hầm mô phỏng văn hóa các quốc gia, tăng thêm phần kịch tính. Ngoài trải nghiệm cảm giác mạnh, du khách còn được chiêm ngưỡng khung cảnh đồi chè, thác nước và bản làng Mộc Châu, biến nơi đây thành điểm đến mạo hiểm hot bậc nhất vùng cao nguyên.',
    imageQueries: ['Bach Long glass bridge', 'Moc Chau glass bridge', 'Bach Long bridge Son La'],
  },
  'Cầu kính Rồng Mây': {
    description:
      'Khu du lịch Cầu kính Rồng Mây nằm trên đèo Ô Quý Hồ thuộc địa phận Lai Châu, nổi tiếng với hệ thống thang máy lồng kính lộ thiên đưa du khách vượt qua vách đá dựng đứng lên độ cao hơn 300m. Từ đỉnh, cây cầu kính vươn ra không trung mở tầm nhìn ngoạn mục xuống thung lũng và dãy Hoàng Liên Sơn.\n\nBên cạnh cầu kính, khu du lịch còn có các trò chơi mạo hiểm như trượt zipline, đu quay ngoài vách núi, khu vui chơi và nhà hàng ngắm cảnh. Nằm ngay ranh giới Lai Châu - Lào Cai, Rồng Mây là điểm dừng chân lý tưởng để thử thách lòng can đảm và tận hưởng thiên nhiên hùng vĩ Tây Bắc.',
    imageQueries: ['Rong May glass bridge', 'O Quy Ho pass', 'Rong May Lai Chau'],
  },
  'Núi Hàm Rồng Sa Pa': {
    description:
      'Núi Hàm Rồng là công viên trên núi ngay trung tâm thị trấn Sa Pa, được quy hoạch thành khu vườn cảnh với muôn loài hoa khoe sắc quanh năm: vườn lan, vườn hoa châu Âu, đào, mận, cùng những vườn đá tự nhiên hình thù kỳ thú. Đường lên núi len qua khe đá "cổng trời" hẹp đầy thú vị.\n\nLên đến Sân Mây và đỉnh Hàm Rồng, du khách phóng tầm mắt ngắm toàn cảnh thị trấn Sa Pa ẩn hiện trong sương và thung lũng Mường Hoa xanh mướt. Tại đây thường có chương trình biểu diễn văn nghệ dân tộc, tạo nên trải nghiệm vừa thư giãn, vừa đậm bản sắc vùng cao chỉ cách trung tâm vài trăm mét đi bộ.',
    imageQueries: ['Núi Hàm Rồng Sa Pa', 'Ham Rong Mountain Sapa', 'Hàm Rồng Sa Pa', 'Sa Pa town'],
  },
  'Dinh thự Vua Mèo (Nhà Vương)': {
    description:
      'Dinh thự họ Vương (còn gọi là Nhà Vương hay dinh Vua Mèo) là công trình kiến trúc độc đáo giữa cao nguyên đá Đồng Văn, được xây dựng đầu thế kỷ 20 cho dòng họ Vương từng cai quản vùng người Mông. Dinh nằm trên thế đất hình mai rùa, bao quanh là hàng cây sa mộc cổ thụ vươn cao.\n\nCông trình pha trộn kiến trúc Mông, Trung Hoa và Pháp với các dãy nhà gỗ hai tầng, mái ngói âm dương, cột đá chạm khắc tinh xảo, lỗ châu mai và bể chứa nước lớn. Bên trong còn trưng bày hiện vật về đời sống, quyền lực của gia tộc. Nhà Vương là điểm dừng chân quan trọng trên cung đường khám phá công viên địa chất toàn cầu Cao nguyên đá Đồng Văn.',
    imageQueries: ['Dinh thự họ Vương', 'Nhà Vương Đồng Văn', 'Hmong Kings palace Dong Van', 'Vương Chính Đức'],
  },
  'Sông Nho Quế - Hẻm Tu Sản': {
    description:
      'Sông Nho Quế bắt nguồn từ Trung Quốc, chảy vào Hà Giang tạo nên dòng nước xanh ngọc bích uốn lượn dưới chân đèo Mã Pí Lèng — một trong "tứ đại đỉnh đèo" của Việt Nam. Đoạn sông chảy qua hẻm vực Tu Sản với vách đá dựng đứng cao hàng trăm mét, được xem là hẻm vực sâu và hùng vĩ bậc nhất Đông Nam Á.\n\nDu khách xuống bến thuyền và đi thuyền máy len giữa hai vách núi khổng lồ, ngước nhìn trời chỉ còn một dải hẹp, cảm nhận sự nhỏ bé của con người trước thiên nhiên kỳ vĩ. Trải nghiệm này thường kết hợp với chinh phục đèo Mã Pí Lèng, ngắm toàn cảnh dòng Nho Quế từ trên cao và khám phá cao nguyên đá Đồng Văn.',
    imageQueries: ['Sông Nho Quế', 'Hẻm Tu Sản', 'Nho Que River', 'Tu San Canyon Ha Giang'],
  },
  'Động Ngườm Ngao': {
    description:
      'Động Ngườm Ngao (theo tiếng Tày nghĩa là "hang hổ") là hang động đá vôi kỳ vĩ nằm gần thác Bản Giốc, dài khoảng 2.100m với ba cửa chính. Trải qua hàng trăm triệu năm kiến tạo, lòng hang hình thành vô số khối thạch nhũ và măng đá muôn hình vạn trạng lấp lánh dưới ánh đèn.\n\nDu khách men theo lối đi được lắp đặt an toàn để chiêm ngưỡng các tuyệt tác tự nhiên như "cây tơ hồng", "đài sen úp ngược", "thác vàng thác bạc" hay hình búp sen, ruộng bậc thang. Không khí trong hang mát lạnh, tĩnh lặng. Ngườm Ngao thường được ghép cùng thác Bản Giốc thành tuyến tham quan hấp dẫn nhất của Cao Bằng.',
    imageQueries: ['Nguom Ngao cave', 'Nguom Ngao Cao Bang', 'Cao Bang cave stalactite'],
  },
  'Khu di tích Pác Bó': {
    description:
      'Khu di tích Pác Bó thuộc huyện Hà Quảng, Cao Bằng — nơi lãnh tụ Nguyễn Ái Quốc trở về nước năm 1941 sau 30 năm bôn ba, trực tiếp lãnh đạo cách mạng Việt Nam. Cảnh quan nơi đây gắn liền những địa danh lịch sử được Bác đặt tên: suối Lê-nin nước xanh biếc, núi Các Mác sừng sững và hang Cốc Bó nơi Người sống và làm việc.\n\nDu khách theo con đường ven suối thăm bàn đá "chông chênh dịch sử Đảng", cột mốc 108 biên giới, lán Khuổi Nặm và nhà tưởng niệm Chủ tịch Hồ Chí Minh. Không gian núi rừng trong lành, thanh tĩnh cùng những câu chuyện lịch sử khiến Pác Bó trở thành địa chỉ đỏ về nguồn thiêng liêng của cả nước.',
    imageQueries: ['Pác Bó', 'Suối Lê Nin Cao Bằng', 'Hang Cốc Bó', 'Pac Bo Cao Bang'],
  },
  'Khu di tích Tân Trào': {
    description:
      'Khu di tích quốc gia đặc biệt Tân Trào ở huyện Sơn Dương, Tuyên Quang là "thủ đô kháng chiến", nơi diễn ra nhiều sự kiện trọng đại trước và trong Cách mạng Tháng Tám 1945. Trung tâm là đình Tân Trào — nơi họp Quốc dân Đại hội, cây đa Tân Trào lịch sử và lán Nà Nưa nơi Bác Hồ ở và làm việc.\n\nQuần thể còn có đình Hồng Thái, hang Bòng, cụm di tích ATK và nhà trưng bày lưu giữ nhiều hiện vật cách mạng. Giữa khung cảnh núi rừng Việt Bắc yên bình, Tân Trào là điểm đến ý nghĩa để tìm hiểu lịch sử cách mạng và tưởng nhớ một thời gian khó mà hào hùng của dân tộc.',
    imageQueries: ['Tan Trao Tuyen Quang', 'Tan Trao banyan tree', 'Tan Trao communal house'],
  },
  'Khu du lịch Hồ Núi Cốc': {
    description:
      'Hồ Núi Cốc là hồ nhân tạo rộng lớn giữa vùng chè Thái Nguyên, nổi tiếng với truyền thuyết tình yêu nàng Công — chàng Cốc đầy bi thương. Mặt hồ mênh mông điểm xuyết hàng chục hòn đảo xanh, quanh năm khí hậu mát mẻ, là điểm nghỉ dưỡng và dã ngoại quen thuộc của vùng Đông Bắc.\n\nKhu du lịch có du thuyền tham quan các đảo, công viên nước, khu huyền thoại cung với hang động nhân tạo kể chuyện tình huyền thoại, vườn thú và khu vui chơi cho trẻ em. Kết hợp với các đồi chè Tân Cương nổi tiếng gần đó, Hồ Núi Cốc mang đến trải nghiệm vừa thư giãn vừa gần gũi thiên nhiên và văn hóa trà.',
    imageQueries: ['Nui Coc lake', 'Ho Nui Coc Thai Nguyen', 'Thai Nguyen lake'],
  },
  'Khu du lịch Tây Yên Tử': {
    description:
      'Khu du lịch Tây Yên Tử nằm ở sườn tây dãy Yên Tử thuộc Bắc Giang, là con đường hoằng dương Phật pháp năm xưa của Phật hoàng Trần Nhân Tông và thiền phái Trúc Lâm. Hệ thống cáp treo hiện đại đưa du khách vượt rừng nguyên sinh Tây Yên Tử lên khu chùa Thượng gần đỉnh non thiêng.\n\nHành trình gắn kết chuỗi chùa, am, tháp cổ như chùa Hạ, chùa Trung và kết nối sang chùa Đồng phía Đông Yên Tử (Quảng Ninh). Không gian núi rừng linh thiêng, trong lành cùng kiến trúc chùa chiền uy nghi khiến Tây Yên Tử là điểm hành hương và du lịch tâm linh sinh thái ngày càng thu hút du khách phía Bắc.',
    imageQueries: ['Tay Yen Tu', 'Yen Tu Bac Giang', 'Tay Yen Tu cable car'],
  },
  'Côn Sơn - Kiếp Bạc': {
    description:
      'Khu di tích quốc gia đặc biệt Côn Sơn - Kiếp Bạc ở Chí Linh, Hải Dương gắn với những danh nhân và anh hùng dân tộc như Trần Hưng Đạo, Nguyễn Trãi, Trần Nguyên Đán, Chu Văn An. Chùa Côn Sơn (Thiên Tư Phúc Tự) cổ kính nằm dưới chân núi rợp bóng thông, có Giếng Ngọc, Thạch Bàn và bàn cờ tiên trên đỉnh núi.\n\nCách đó không xa là đền Kiếp Bạc uy nghi bên sông Lục Đầu, thờ Hưng Đạo Đại Vương Trần Quốc Tuấn — nơi diễn ra lễ hội mùa thu thu hút hàng vạn người về dâng hương. Cảnh quan sơn thủy hữu tình, rừng thông bạt ngàn cùng giá trị lịch sử - văn hóa sâu sắc khiến nơi đây là điểm hành hương và vãn cảnh nổi tiếng đồng bằng Bắc Bộ.',
    imageQueries: ['Đền Kiếp Bạc', 'Chùa Côn Sơn', 'Kiep Bac Temple', 'Con Son Pagoda Chi Linh'],
  },
  'Bản Lác Mai Châu': {
    description:
      'Bản Lác là bản người Thái trắng lâu đời trong thung lũng Mai Châu, Hòa Bình, được bao quanh bởi những cánh đồng lúa xanh mướt và dãy núi trùng điệp. Nổi tiếng là điểm du lịch cộng đồng tiêu biểu của Tây Bắc, bản giữ được nếp nhà sàn truyền thống nay đón khách lưu trú homestay.\n\nDu khách đạp xe quanh bản, ngắm ruộng lúa, tìm hiểu nghề dệt thổ cẩm, mua sắm sản phẩm thủ công và thưởng thức ẩm thực dân tộc như cơm lam, thịt nướng, rượu cần. Buổi tối, những điệu múa xòe, múa sạp bên ánh lửa cùng người dân bản địa mang lại trải nghiệm văn hóa ấm áp, khó quên giữa thiên nhiên Mai Châu thanh bình.',
    imageQueries: ['Bản Lác Mai Châu', 'Mai Chau valley', 'Thung lũng Mai Châu', 'Mai Chau Hoa Binh'],
  },
  'Đền Đô (Đền Lý Bát Đế)': {
    description:
      'Đền Đô (đền Lý Bát Đế) ở Đình Bảng, Bắc Ninh là nơi thờ tám vị vua triều Lý — triều đại khai mở nền văn minh Đại Việt và dời đô về Thăng Long. Đền được xây dựng bề thế trên đất "địa linh", bao quanh là hồ bán nguyệt, nhà thủy đình soi bóng nước — hình ảnh từng in trên tờ tiền Việt Nam.\n\nQuần thể kiến trúc gồm cổng Ngũ Long Môn, Chính điện, nhà Tiền tế, nhà bia cùng nhiều hoành phi câu đối sơn son thếp vàng. Là trung tâm văn hóa tâm linh vùng Kinh Bắc, đền Đô thu hút đông đảo du khách vào dịp lễ hội đầu xuân, tiện kết hợp tham quan chùa Bút Tháp, chùa Dâu và nghe quan họ trên vùng đất giàu di sản.',
    imageQueries: ['Do temple Bac Ninh', 'Den Do Ly dynasty', 'Dinh Bang temple'],
  },
  'Chùa Keo': {
    description:
      'Chùa Keo (Thần Quang Tự) ở Vũ Thư, Thái Bình là một trong những ngôi chùa cổ có kiến trúc gỗ đẹp và độc đáo bậc nhất Việt Nam, được xây dựng từ thế kỷ 17 và bảo tồn gần như nguyên vẹn. Chùa thờ Phật và Thiền sư Không Lộ, với quy mô hàng trăm gian nhà nối tiếp hài hòa.\n\nCông trình tiêu biểu nhất là gác chuông ba tầng cao gần 12m làm hoàn toàn bằng gỗ, kết cấu mộng gỗ tinh xảo không dùng đinh, dáng vươn thanh thoát như đóa sen — biểu tượng của chùa Keo. Hằng năm chùa mở hội xuân và hội thu với nhiều nghi lễ, trò chơi dân gian, thu hút đông đảo du khách và phật tử về chiêm bái vãn cảnh.',
    imageQueries: ['Keo pagoda Thai Binh', 'Chua Keo bell tower', 'Keo pagoda Vietnam'],
  },
  'Phố Hiến - Chùa Chuông': {
    description:
      'Phố Hiến (Hưng Yên) từng là thương cảng sầm uất bậc nhất Đàng Ngoài thế kỷ 16–17, lưu truyền câu "thứ nhất Kinh Kỳ, thứ nhì Phố Hiến". Ngày nay khu di tích quốc gia đặc biệt Phố Hiến còn lưu giữ hàng chục công trình cổ kính phản ánh sự giao thoa văn hóa Việt - Hoa - Nhật một thời phồn thịnh.\n\nĐiểm nhấn là chùa Chuông được ví như "Phố Hiến đệ nhất danh lam" với cầu đá, cây cầu, vườn tháp và hệ thống tượng sinh động; cùng Văn Miếu Xích Đằng, đền Mẫu, đền Trần và các hội quán cổ. Dạo bước giữa những di tích rêu phong bên hồ Bán Nguyệt, du khách như ngược dòng thời gian về thương cảng vàng son xưa.',
    imageQueries: ['Pho Hien Hung Yen', 'Chuong pagoda Hung Yen', 'Xich Dang temple of literature'],
  },
  'Khu di tích Đền Trần - Chùa Phổ Minh': {
    description:
      'Khu di tích Đền Trần - Chùa Phổ Minh ở Nam Định là nơi phát tích và tôn thờ vương triều Trần — triều đại ba lần đánh thắng quân Nguyên Mông. Đền Trần gồm đền Thiên Trường, đền Cố Trạch và đền Trùng Hoa, thờ các vua Trần và Hưng Đạo Đại Vương, nổi tiếng với lễ Khai ấn đầu xuân thu hút hàng vạn người.\n\nNgay cạnh là chùa Phổ Minh với tháp Phổ Minh 14 tầng cao gần 20m xây từ thời Trần — một trong những bảo vật kiến trúc cổ quý giá còn lại. Không gian cổ kính, trầm mặc cùng các lễ hội truyền thống khiến cụm di tích này là điểm hành hương và tìm hiểu lịch sử hào hùng thời Trần.',
    imageQueries: ['Tran temple Nam Dinh', 'Pho Minh pagoda tower', 'Den Tran Nam Dinh'],
  },
  'Vườn quốc gia Ba Vì': {
    description:
      'Vườn quốc gia Ba Vì là "lá phổi xanh" phía tây Hà Nội, trải trên dãy núi Ba Vì với ba đỉnh Vua, Tản Viên, Ngọc Hoa quanh năm mây phủ. Rừng nguyên sinh đa dạng sinh học cùng khí hậu mát mẻ khiến nơi đây trở thành điểm nghỉ dưỡng, dã ngoại và trekking được yêu thích.\n\nDu khách check-in nhà thờ đổ và các phế tích Pháp cổ rêu phong huyền ảo, thăm đền Thượng thờ Tản Viên Sơn Thánh, đền thờ Bác Hồ trên đỉnh Vua, rừng thông, vườn xương rồng và những đồi hoa dã quỳ vàng rực mùa đông. Cung đường lên núi uốn lượn giữa rừng già cũng là trải nghiệm hấp dẫn với người mê phượt và nhiếp ảnh.',
    imageQueries: ['Ba Vi National Park', 'Ba Vi mountain Hanoi', 'Ba Vi French ruins'],
  },
  'Làng gốm Bát Tràng': {
    description:
      'Làng gốm Bát Tràng bên bờ sông Hồng là làng nghề gốm sứ truyền thống hơn 500 năm tuổi, nổi tiếng cả nước với những sản phẩm men lam, men rạn tinh xảo. Dạo bước trong làng cổ, du khách khám phá những con ngõ nhỏ, nhà cổ, lò bầu xưa và chợ gốm bày bán muôn vàn sản phẩm từ đồ gia dụng đến tác phẩm nghệ thuật.\n\nĐiểm nhấn hiện đại là Trung tâm Tinh hoa Làng nghề Việt (Bảo tàng gốm Bát Tràng) với kiến trúc xoáy độc đáo như những bàn xoay gốm khổng lồ. Trải nghiệm được yêu thích nhất là tự tay nặn, vẽ và tráng men sản phẩm dưới hướng dẫn của nghệ nhân — hoạt động thú vị cho cả gia đình và các bạn trẻ.',
    imageQueries: ['Bat Trang ceramic village', 'Bat Trang pottery', 'Bat Trang museum Hanoi'],
  },
  'Bảo tàng Lịch sử Quân sự Việt Nam': {
    description:
      'Bảo tàng Lịch sử Quân sự Việt Nam cơ sở mới tại quận Nam Từ Liêm là bảo tàng quân sự hiện đại và quy mô bậc nhất Đông Nam Á, ứng dụng công nghệ trình chiếu, sa bàn 3D và thực tế ảo để tái hiện lịch sử dựng nước và giữ nước của dân tộc. Điểm nhấn kiến trúc là Tháp Chiến thắng cao 45m biểu tượng cho năm 1945.\n\nBảo tàng trưng bày hàng vạn hiện vật, trong đó có nhiều bảo vật quốc gia và các khí tài lớn ngoài trời như máy bay MiG, xe tăng, pháo, trực thăng. Không gian rộng rãi, cách bố trí trực quan sinh động khiến nơi đây nhanh chóng trở thành điểm tham quan, giáo dục truyền thống thu hút đông đảo người dân và du khách.',
    imageQueries: ['Vietnam Military History Museum', 'Vietnam military museum Hanoi', 'MiG aircraft museum Hanoi'],
  },
  'Sun World Ha Long': {
    description:
      'Sun World Ha Long là tổ hợp vui chơi giải trí ven vịnh Hạ Long, kết hợp hài hòa giữa biển và núi. Điểm nhấn là tuyến cáp treo Nữ Hoàng với cabin hai tầng lớn nhất thế giới, đưa du khách lên đồi Ba Đèo, nơi có vòng quay Mặt Trời (Sun Wheel) khổng lồ ngắm toàn cảnh kỳ quan vịnh Hạ Long từ trên cao.\n\nTrên đỉnh đồi còn có khu vườn Nhật Zen, tượng Quan Âm và công viên. Dưới chân là Công viên Rồng với nhiều trò chơi cảm giác mạnh và công viên nước hiện đại. Về đêm, cả khu rực rỡ ánh đèn soi bóng xuống vịnh, mang đến trải nghiệm giải trí sôi động bên cạnh hành trình khám phá di sản thiên nhiên thế giới.',
    imageQueries: ['Sun World Ha Long', 'Sun Wheel Ha Long', 'Queen Cable Car Ha Long'],
  },
  'Bảo tàng Quảng Ninh': {
    description:
      'Bảo tàng Quảng Ninh bên bờ vịnh Hạ Long là công trình kiến trúc ấn tượng với lớp vỏ kính đen phản chiếu trời mây và mặt biển, được thiết kế lấy cảm hứng từ than đá — đặc sản của vùng đất Mỏ. Đây là một trong những bảo tàng đẹp và hiện đại nhất Việt Nam, điểm check-in nổi tiếng của Hạ Long.\n\nBên trong trưng bày theo ba chủ đề: thiên nhiên và biển đảo Quảng Ninh với bộ xương cá voi lớn, lịch sử - văn hóa vùng đất qua các thời kỳ, và ngành khai thác than với mô hình hầm lò sinh động. Không gian rộng, hiện vật phong phú giúp du khách hiểu sâu về vùng đất, con người và di sản vịnh Hạ Long.',
    imageQueries: ['Quang Ninh Museum', 'Ha Long museum building', 'Quang Ninh museum black glass'],
  },
  'Cố đô Hoa Lư': {
    description:
      'Cố đô Hoa Lư là kinh đô đầu tiên của nhà nước Đại Cồ Việt độc lập dưới thời Đinh và Tiền Lê (thế kỷ 10), nằm giữa vùng núi đá vôi hiểm trở của Ninh Bình. Tuy các cung điện xưa không còn, khu di tích vẫn lưu giữ dấu ấn kinh đô qua nền móng khảo cổ và hai ngôi đền cổ uy nghi.\n\nĐền vua Đinh Tiên Hoàng và đền vua Lê Đại Hành mang kiến trúc "nội công ngoại quốc" với những mảng chạm khắc đá, gỗ tinh xảo thời Hậu Lê, thờ hai vị vua khai quốc. Nằm trong quần thể danh thắng Tràng An, Hoa Lư là điểm đến giàu giá trị lịch sử, thường được kết hợp cùng Tràng An, Tam Cốc trong hành trình khám phá "kinh đô đá".',
    imageQueries: ['Hoa Lu ancient capital', 'Dinh Tien Hoang temple', 'Hoa Lu Ninh Binh'],
  },
  'Vườn chim Thung Nham': {
    description:
      'Khu du lịch sinh thái Thung Nham nằm trong vùng lõi quần thể danh thắng Tràng An, nổi tiếng với vườn chim tự nhiên quy tụ hàng vạn cá thể thuộc nhiều loài như cò, vạc, diệc, le le và cả những loài quý hiếm. Cảnh tượng đàn chim bay rợp trời về tổ lúc hoàng hôn là trải nghiệm khó quên.\n\nBên cạnh vườn chim, Thung Nham còn có hệ thống hang động như động Vái Giời, động Tiên Cá, cây đa di sản nghìn năm, hang Bụt và các tuyến thuyền len lỏi giữa đầm nước, rừng cây xanh mát. Không gian yên bình, hoang sơ cùng dịch vụ lưu trú sinh thái khiến nơi đây là điểm nghỉ dưỡng gần gũi thiên nhiên hấp dẫn của Ninh Bình.',
    imageQueries: ['Thung Nham bird garden', 'Thung Nham Ninh Binh', 'Thung Nham ecotourism'],
  },
  'Vườn quốc gia Cúc Phương': {
    description:
      'Vườn quốc gia Cúc Phương là vườn quốc gia đầu tiên của Việt Nam, trải rộng trên vùng rừng mưa nhiệt đới nguyên sinh với hệ động thực vật vô cùng phong phú. Nhiều năm liền Cúc Phương được bình chọn là vườn quốc gia hàng đầu châu Á, hấp dẫn du khách yêu thiên nhiên và các nhà nghiên cứu.\n\nĐiểm nổi bật gồm cây chò xanh ngàn năm cao vút, cây đăng cổ thụ, động Người Xưa lưu dấu tích cư dân tiền sử, hồ Mạc và các tuyến trekking xuyên rừng. Vườn còn có Trung tâm cứu hộ linh trưởng nguy cấp, chương trình xem đom đóm mùa hè và tìm hiểu bảo tồn, mang lại trải nghiệm sinh thái giáo dục ý nghĩa cho mọi lứa tuổi.',
    imageQueries: ['Cuc Phuong National Park', 'Cuc Phuong ancient tree', 'Cuc Phuong forest'],
  },
  'Suối cá thần Cẩm Lương': {
    description:
      'Suối cá thần Cẩm Lương ở huyện Cẩm Thủy, Thanh Hóa là hiện tượng thiên nhiên kỳ thú với hàng nghìn con cá thân hình lớn, vảy ánh màu sặc sỡ sống dày đặc trong dòng suối trong vắt chảy ra từ chân núi đá. Người dân địa phương coi đàn cá là linh thiêng, không ai đánh bắt nên cá dạn dĩ, quây quần bên du khách.\n\nBên cạnh suối cá là hang động, đền thờ thần Rắn và bản Mường Cẩm Lương với nếp nhà sàn, ruộng nương yên bình. Du khách có thể ngắm đàn cá, khám phá hang núi, tìm hiểu văn hóa Mường và thưởng thức đặc sản địa phương. Đây là điểm tham quan độc đáo gắn với những truyền thuyết dân gian hấp dẫn của xứ Thanh.',
    imageQueries: ['Suối cá Cẩm Lương', 'Suối cá thần Cẩm Lương', 'Cam Luong fish stream', 'Cẩm Thủy Thanh Hóa'],
  },
  'Khu bảo tồn thiên nhiên Pù Luông': {
    description:
      'Khu bảo tồn thiên nhiên Pù Luông thuộc huyện Bá Thước, Thanh Hóa là vùng núi rừng nguyên sơ với những thung lũng ruộng bậc thang xanh mướt, bản làng người Thái, Mường và hệ sinh thái rừng nhiệt đới đa dạng. Khí hậu mát mẻ quanh năm cùng cảnh quan hoang sơ khiến Pù Luông trở thành điểm nghỉ dưỡng, trekking được ưa chuộng.\n\nDu khách trekking qua các bản Đôn, Kho Mường, Son Bá Mười, ngắm guồng nước, thác nước, ruộng lúa chín vàng mùa thu và lưu trú trong những khu nghỉ sinh thái ẩn giữa thiên nhiên. Trải nghiệm đạp xe làng quê, tắm suối, thưởng thức ẩm thực bản địa và hòa mình vào nhịp sống chậm rãi là điều níu chân du khách khi đến Pù Luông.',
    imageQueries: ['Pu Luong Nature Reserve', 'Pu Luong terraced fields', 'Pu Luong Thanh Hoa'],
  },
  'Vườn quốc gia Pù Mát': {
    description:
      'Vườn quốc gia Pù Mát là vùng lõi của Khu dự trữ sinh quyển thế giới miền Tây Nghệ An, bảo tồn diện tích rừng nguyên sinh rộng lớn với hệ động thực vật quý hiếm như sao la, voi, hổ và nhiều loài linh trưởng. Đây là điểm đến hấp dẫn cho du lịch sinh thái và khám phá thiên nhiên.\n\nNổi tiếng nhất là thác Khe Kèm cao khoảng 150m đổ xuống như dải lụa trắng giữa rừng già, cùng sông Giăng thơ mộng nơi có tộc người Đan Lai sinh sống, suối nước Mọc và rừng săng lẻ độc đáo. Du khách có thể trekking, đi thuyền trên sông Giăng, tắm thác và tìm hiểu văn hóa các dân tộc thiểu số vùng biên giới Việt - Lào.',
    imageQueries: ['Pu Mat National Park', 'Khe Kem waterfall', 'Pu Mat Nghe An'],
  },
  'Chùa Hương Tích Hà Tĩnh': {
    description:
      'Chùa Hương Tích tọa lạc trên lưng chừng đỉnh Hương Tích thuộc dãy Hồng Lĩnh, Hà Tĩnh, được mệnh danh "Hoan Châu đệ nhất danh lam". Tương truyền đây là nơi công chúa Diệu Thiện tu hành đắc đạo, gắn với sự tích Quan Âm, mang giá trị tâm linh sâu sắc và lịch sử lâu đời.\n\nDu khách lên chùa bằng thuyền qua hồ Nhà Đường, sau đó đi cáp treo hoặc leo bộ theo đường rừng lên các am, miếu và chùa chính ẩn giữa mây núi. Từ trên cao có thể phóng tầm mắt ngắm toàn cảnh vùng đồng bằng Hà Tĩnh xanh ngát. Mỗi độ xuân về, chùa Hương Tích đón hàng vạn phật tử và du khách hành hương lễ Phật, vãn cảnh.',
    imageQueries: ['Huong Tich pagoda Ha Tinh', 'Hong Linh mountain', 'Chua Huong Ha Tinh'],
  },
  'Suối nước Moọc': {
    description:
      'Suối nước Moọc là khu du lịch sinh thái nằm trong Vườn quốc gia Phong Nha - Kẻ Bàng, nơi dòng nước xanh ngọc bích trào lên từ lòng đất, chảy len lỏi giữa rừng nguyên sinh trên nền đá vôi. Khung cảnh trong lành, mát mẻ với những khúc suối đẹp như tranh khiến nơi đây được nhiều du khách yêu thích.\n\nDu khách đi bộ trên hệ thống cầu gỗ men theo dòng suối, tắm mát ở những hồ nước trong veo, chèo kayak, đu dây zipline hoặc thư giãn trong không gian rừng núi. Kết hợp với động Phong Nha, động Thiên Đường và các hang động Quảng Bình, Suối nước Moọc là điểm dừng chân lý tưởng để hòa mình vào thiên nhiên hoang sơ.',
    imageQueries: ['Suối nước Moọc', 'Nước Moọc', 'Mooc Spring', 'Phong Nha Ke Bang'],
  },
  'Đôi bờ Hiền Lương - Bến Hải': {
    description:
      'Cụm di tích đôi bờ Hiền Lương - Bến Hải là chứng tích lịch sử về nỗi đau chia cắt hai miền Nam - Bắc suốt hơn 20 năm bên vĩ tuyến 17. Cầu Hiền Lương bắc qua sông Bến Hải cùng cột cờ giới tuyến, nhà Liên hợp và loa phóng thanh tái hiện giai đoạn đấu tranh thống nhất đất nước.\n\nBên bờ bắc là cụm tượng đài "Khát vọng thống nhất" khắc họa hình ảnh người mẹ và em bé chờ mong ngày đoàn tụ, cùng nhà trưng bày "Vĩ tuyến 17 và khát vọng thống nhất". Ghé thăm nơi đây, du khách cảm nhận sâu sắc giá trị của hòa bình, độc lập và tinh thần bất khuất của dân tộc trong những năm tháng khốc liệt nhất.',
    imageQueries: ['Cầu Hiền Lương', 'Hien Luong Bridge', 'Sông Bến Hải', 'Ben Hai River'],
  },
  'Lăng Tự Đức': {
    description:
      'Lăng Tự Đức (Khiêm Lăng) thuộc Quần thể di tích Cố đô Huế được UNESCO công nhận, là một trong những lăng tẩm đẹp và thơ mộng nhất triều Nguyễn. Được chính vua Tự Đức cho xây khi còn sống làm nơi nghỉ ngơi, lăng giống như một khu vườn thượng uyển với hồ sen, đình tạ soi bóng nước giữa rừng thông xanh mát.\n\nQuần thể gồm khu tẩm điện với điện Hòa Khiêm, Lương Khiêm, nhà hát Minh Khiêm cổ nhất Việt Nam, và khu lăng mộ với Bi Đình đặt tấm bia đá lớn khắc bài "Khiêm Cung Ký" do vua tự soạn. Không gian tĩnh lặng, hài hòa giữa kiến trúc và thiên nhiên khiến Khiêm Lăng phản ánh rõ tâm hồn thi sĩ của vị vua trị vì lâu nhất triều Nguyễn.',
    imageQueries: ['Tu Duc tomb Hue', 'Khiem Lang', 'Tu Duc royal tomb'],
  },
  'Lăng Minh Mạng': {
    description:
      'Lăng Minh Mạng (Hiếu Lăng) nằm bên ngã ba Bằng Lãng nơi hợp lưu hai nguồn tả, hữu trạch thành sông Hương, thuộc Quần thể di tích Cố đô Huế. Đây được xem là lăng tẩm có bố cục cân đối, uy nghi và cổ kính bậc nhất, phản ánh tính cách nghiêm cẩn của vị vua có nhiều cải cách lớn.\n\nGần 40 công trình lớn nhỏ được sắp đặt đối xứng trên một trục thần đạo, trải dài qua Đại Hồng Môn, sân chầu với tượng quan văn võ, Bi Đình, điện Sùng Ân, hồ Trừng Minh với cầu bắc qua, đến Bửu Thành nơi đặt mộ vua giữa đồi thông. Cảnh quan kiến trúc hòa quyện với sông nước, cây xanh tạo nên một bức tranh sơn thủy trang nghiêm và thanh bình.',
    imageQueries: ['Minh Mang tomb', 'Minh Mang royal tomb Hue', 'Hieu Lang Hue'],
  },
  'Bảo tàng Điêu khắc Chăm Đà Nẵng': {
    description:
      'Bảo tàng Điêu khắc Chăm Đà Nẵng được người Pháp thành lập từ đầu thế kỷ 20, là nơi lưu giữ bộ sưu tập nghệ thuật điêu khắc Chăm Pa lớn và độc đáo nhất thế giới. Tòa nhà mang phong cách kiến trúc kết hợp Pháp và đường nét Chăm, nằm bên sông Hàn giữa trung tâm thành phố.\n\nHơn 2.000 hiện vật bằng sa thạch, đất nung được trưng bày theo các phòng gắn với những vùng đất Chăm như Trà Kiệu, Mỹ Sơn, Đồng Dương, Tháp Mẫm, trong đó có nhiều bảo vật quốc gia. Các tác phẩm khắc họa thần linh, vũ nữ Apsara, linh vật Ấn Độ giáo với đường nét tinh xảo, giúp du khách hiểu sâu về nền văn minh Chăm Pa rực rỡ một thời.',
    imageQueries: ['Museum of Cham Sculpture', 'Cham sculpture Da Nang', 'Champa art museum'],
  },
  'Rừng dừa Bảy Mẫu Cẩm Thanh': {
    description:
      'Rừng dừa Bảy Mẫu ở xã Cẩm Thanh, cách phố cổ Hội An vài km, là khu rừng dừa nước xanh mát được ví như "miền Tây thu nhỏ" của miền Trung. Trong kháng chiến, đây từng là căn cứ cách mạng; ngày nay trở thành điểm du lịch sinh thái cộng đồng nổi tiếng.\n\nDu khách ngồi thuyền thúng do người dân chèo, len lỏi giữa những rặng dừa nước rợp bóng, xem màn "lắc thúng" xoay tròn điêu luyện, quăng chài bắt cá và tự tay làm đồ thủ công từ lá dừa. Trải nghiệm dân dã, vui nhộn cùng khung cảnh sông nước bình yên khiến rừng dừa Bảy Mẫu là điểm đến được yêu thích khi ghé Hội An.',
    imageQueries: ['Rừng dừa Bảy Mẫu', 'Cẩm Thanh Hội An', 'Bay Mau coconut forest', 'Thuyền thúng Hội An'],
  },
  'VinWonders Nam Hội An': {
    description:
      'VinWonders Nam Hội An là công viên chủ đề lớn ven biển Quảng Nam, lấy cảm hứng từ văn hóa và bản sắc Việt. Điểm nhấn là phân khu Đảo Ký Ức (River Safari) — nơi tái hiện thương cảng Hội An xưa với những màn trình diễn thực cảnh sống động về một thời giao thương phồn thịnh.\n\nCông viên gồm nhiều phân khu: bến cảng giao thoa, vùng đất phiêu lưu với trò chơi cảm giác mạnh, công viên nước, vườn thú River Safari đi thuyền ngắm động vật và khu dân gian tái hiện làng nghề truyền thống. Với không gian rộng, nhiều show diễn đặc sắc, VinWonders Nam Hội An là điểm vui chơi cả ngày lý tưởng cho gia đình khi du lịch Hội An - Đà Nẵng.',
    imageQueries: ['VinWonders Nam Hoi An', 'Nam Hoi An park', 'River Safari Hoi An'],
  },
  'Tháp Đôi Quy Nhơn': {
    description:
      'Tháp Đôi (còn gọi tháp Hưng Thạnh) là cụm hai tháp Chăm cổ nằm ngay trong lòng thành phố Quy Nhơn, được xây dựng khoảng thế kỷ 12–13. Khác với các tháp Chăm truyền thống, phần đỉnh Tháp Đôi có dáng cong tròn mềm mại, mang ảnh hưởng nghệ thuật Khmer, tạo nên vẻ độc đáo hiếm thấy.\n\nHai ngọn tháp bằng gạch nung đỏ được trang trí bằng những phù điêu chim thần Garuda, vũ nữ, quái vật và hoa văn tinh xảo ở các góc và cửa. Sau trùng tu, di tích khang trang giữa khuôn viên cây xanh, trở thành điểm tham quan văn hóa hấp dẫn, tiện ghé thăm khi khám phá thành phố biển Quy Nhơn.',
    imageQueries: ['Thap Doi Quy Nhon', 'Twin towers Cham Quy Nhon', 'Hung Thanh tower'],
  },
  'Tháp Nhạn': {
    description:
      'Tháp Nhạn là ngọn tháp Chăm cổ tọa lạc trên đỉnh núi Nhạn bên bờ sông Đà Rằng, được xem là biểu tượng của thành phố Tuy Hòa, Phú Yên. Tháp được xây dựng khoảng thế kỷ 11–12, cao gần 24m với kiến trúc vuông vức, đường nét thanh thoát tiêu biểu cho nghệ thuật Chăm Pa.\n\nTừ chân tháp, du khách phóng tầm mắt ngắm toàn cảnh thành phố Tuy Hòa, dòng sông Đà Rằng và cầu Đà Rằng dài. Về đêm, tháp được chiếu sáng lung linh, trở thành nơi hóng mát, dạo chơi quen thuộc của người dân và du khách. Tháp Nhạn cùng những bãi biển, gành đá của Phú Yên tạo nên hành trình khám phá "xứ hoa vàng cỏ xanh" đầy thi vị.',
    imageQueries: ['Nhan tower Tuy Hoa', 'Thap Nhan Phu Yen', 'Nhan tower Cham'],
  },
  'Đảo Hòn Tằm': {
    description:
      'Hòn Tằm là hòn đảo xanh mát trong vịnh Nha Trang, mang hình dáng như con tằm nằm nghỉ giữa biển khơi. Đảo còn giữ được vẻ hoang sơ với rừng nhiệt đới, bãi cát trắng mịn và làn nước biển trong xanh, là điểm nghỉ dưỡng và vui chơi biển được yêu thích.\n\nDu khách di chuyển bằng cano hoặc du thuyền từ đất liền, sau đó thỏa sức tắm biển, chơi các môn thể thao dưới nước như dù bay, jetski, lặn ngắm san hô, hoặc thư giãn với dịch vụ tắm bùn khoáng, hồ bơi ngắm biển. Không gian yên bình, dịch vụ đa dạng khiến Hòn Tằm phù hợp cho cả nhóm bạn, gia đình và các cặp đôi.',
    imageQueries: ['Hon Tam island Nha Trang', 'Hon Tam beach', 'Nha Trang island resort'],
  },
  'Tháp Po Klong Garai': {
    description:
      'Cụm tháp Po Klong Garai tọa lạc trên đồi Trầu ở Phan Rang - Tháp Chàm, là quần thể tháp Chăm được bảo tồn nguyên vẹn và đẹp bậc nhất còn lại đến nay, xây dựng khoảng cuối thế kỷ 13. Tháp thờ vua Po Klong Garai — vị vua có công trị thủy, được người Chăm tôn kính như thần.\n\nQuần thể gồm tháp Chính, tháp Lửa và tháp Cổng với những mảng điêu khắc tinh xảo hình thần Shiva, bò thần Nandin và các hoa văn đặc trưng. Đây là trung tâm diễn ra lễ hội Katê rộn ràng hằng năm của cộng đồng người Chăm. Đứng trên đồi Trầu, du khách vừa chiêm ngưỡng kiến trúc cổ, vừa ngắm toàn cảnh vùng đất nắng gió Ninh Thuận.',
    imageQueries: ['Po Klong Garai', 'Po Klong Garai towers', 'Cham tower Phan Rang'],
  },
  'Bàu Trắng': {
    description:
      'Bàu Trắng là hồ nước ngọt tự nhiên nằm giữa những đồi cát trắng mênh mông ở huyện Bắc Bình, Bình Thuận, được ví như "tiểu sa mạc Sahara" của Việt Nam. Sự tương phản giữa hồ nước trong xanh phủ đầy sen hồng và những triền cát trắng trải dài dưới nắng tạo nên khung cảnh siêu thực, đầy mê hoặc.\n\nDu khách đến Bàu Trắng để ngắm bình minh, hoàng hôn tuyệt đẹp, trải nghiệm trượt cát, đi xe địa hình mô tô hoặc xe jeep chinh phục đồi cát và chụp những bức ảnh ấn tượng. Cung đường ven biển từ Mũi Né đến Bàu Trắng cũng rất đẹp, thích hợp cho hành trình khám phá miền cát trắng nắng vàng của Bình Thuận.',
    imageQueries: ['Bau Trang white sand dunes', 'Bau Trang Binh Thuan', 'White lake sand dunes Vietnam'],
  },
  'Tháp Po Sah Inư': {
    description:
      'Nhóm tháp Po Sah Inư nằm trên đồi Bà Nài, phường Phú Hài, thành phố Phan Thiết, là di tích kiến trúc Chăm Pa có niên đại khoảng thế kỷ 8–9, thuộc phong cách nghệ thuật Hòa Lai cổ kính. Tháp thờ công chúa Po Sah Inư — người con của vua Chăm được dân yêu kính vì có công dạy nghề cho dân.\n\nCụm gồm ba tháp còn khá nguyên vẹn với kiến trúc vuông vắn, gạch nung đỏ và những nét chạm khắc đặc trưng. Từ đồi tháp, du khách ngắm được biển Phan Thiết, cảng cá và thành phố phía xa. Đây cũng là nơi diễn ra lễ hội Katê của người Chăm, mang đến trải nghiệm văn hóa đặc sắc bên cạnh vẻ đẹp cổ kính, trầm mặc của di tích.',
    imageQueries: ['Po Sah Inu towers', 'Po Sah Inu Phan Thiet', 'Cham tower Binh Thuan'],
  },
  'Khu du lịch Tà Cú': {
    description:
      'Khu du lịch núi Tà Cú ở huyện Hàm Thuận Nam, Bình Thuận là ngọn núi xanh mát cao hơn 600m giữa vùng đất nắng gió, nổi tiếng với ngôi chùa Linh Sơn Trường Thọ cổ kính và pho tượng Phật Thích Ca nhập niết bàn dài 49m — tượng Phật nằm dài vào loại lớn nhất Đông Nam Á.\n\nDu khách lên núi bằng cáp treo vượt rừng nguyên sinh hoặc leo bộ theo đường mòn, viếng chùa, chiêm bái tượng Phật và tận hưởng không khí trong lành, tầm nhìn thoáng đãng ra vùng đồng bằng ven biển. Với sự kết hợp giữa cảnh quan thiên nhiên và giá trị tâm linh, Tà Cú là điểm hành hương và vãn cảnh hấp dẫn của Bình Thuận.',
    imageQueries: ['Ta Cu mountain', 'Linh Son Truong Tho pagoda', 'reclining Buddha Ta Cu'],
  },
  'Thác Pongour': {
    description:
      'Thác Pongour ở huyện Đức Trọng, Lâm Đồng được mệnh danh là "Nam thiên đệ nhất thác" — thác đẹp nhất phương Nam. Dòng thác rộng hàng chục mét đổ xuống qua bảy tầng đá bọt phủ rêu xanh, giữa khung cảnh rừng nguyên sinh, tạo nên bức tranh thiên nhiên hùng vĩ mà thơ mộng.\n\nVào mùa mưa, thác cuồn cuộn tung bọt trắng xóa hùng tráng; mùa khô lại êm đềm len qua các bậc đá. Khu vực quanh thác có lối đi bộ, cầu, tiểu cảnh để du khách ngắm cảnh và chụp ảnh. Không khí mát lành cùng vẻ đẹp nguyên sơ khiến Pongour là điểm dừng chân được yêu thích trên hành trình khám phá cao nguyên Lâm Đồng - Đà Lạt.',
    imageQueries: ['Thác Pongour', 'Pongour Waterfall', 'Pongour Falls', 'Đức Trọng Lâm Đồng'],
  },
  'Khu du lịch Langbiang': {
    description:
      'Langbiang là dãy núi biểu tượng của cao nguyên Lâm Viên, gắn với truyền thuyết tình yêu bất tử của chàng K-lang và nàng Ho-biang. Đỉnh Radar cao khoảng 1.929m là điểm ngắm cảnh nổi tiếng, nơi du khách phóng tầm mắt bao quát thành phố Đà Lạt, hồ Đankia - Suối Vàng và những rừng thông bạt ngàn.\n\nDu khách có thể chinh phục đỉnh bằng xe jeep men theo con đường dốc quanh co hoặc trekking xuyên rừng thông. Dưới chân núi có khu vui chơi, biểu diễn cồng chiêng, giao lưu văn hóa dân tộc K-Ho và thưởng thức đặc sản Tây Nguyên. Langbiang mang đến trải nghiệm vừa phiêu lưu, vừa lãng mạn giữa thiên nhiên hùng vĩ của Đà Lạt.',
    imageQueries: ['Langbiang mountain Da Lat', 'Langbiang peak', 'Lang Biang Lam Dong'],
  },
  'Buôn Đôn': {
    description:
      'Buôn Đôn thuộc tỉnh Đắk Lắk là vùng đất huyền thoại nổi tiếng với nghề săn bắt và thuần dưỡng voi rừng, gắn với hình ảnh "vua săn voi" Khunjunob. Nơi đây mang đậm bản sắc văn hóa các dân tộc Tây Nguyên như Ê Đê, M-nông, Lào bên dòng sông Sêrêpốk cuộn chảy.\n\nDu khách khám phá những cây cầu treo bắc qua sông len giữa rừng si cổ thụ, tham quan nhà sàn cổ, mộ vua voi, tìm hiểu văn hóa cồng chiêng và thưởng thức rượu cần, cơm lam. Ngày nay các hoạt động du lịch chuyển dần sang thân thiện với voi, mang lại trải nghiệm khám phá thiên nhiên và văn hóa bản địa đặc sắc của đại ngàn Tây Nguyên.',
    imageQueries: ['Buon Don Dak Lak', 'Buon Don suspension bridge', 'Serepok river Buon Don'],
  },
  'Cụm thác Dray Sáp - Gia Long': {
    description:
      'Cụm thác Dray Sáp - Gia Long nằm trên dòng Sêrêpốk thuộc tỉnh Đắk Nông, trong vùng Công viên địa chất toàn cầu UNESCO Đắk Nông. Thác Dray Sáp còn gọi là "thác Khói" bởi khi nước đổ mạnh, hơi nước bốc lên mù mịt như làn khói bao phủ cả một vùng, tạo khung cảnh huyền ảo.\n\nCách đó không xa là thác Gia Long hiền hòa, thơ mộng với hồ tắm tự nhiên và những bãi đá, rừng cây xanh mát. Du khách men theo lối mòn và cầu treo khám phá hai ngọn thác, tắm mát, cắm trại và chụp ảnh giữa thiên nhiên hoang sơ. Đây là điểm đến hấp dẫn cho những ai yêu thích vẻ đẹp hùng vĩ, nguyên sơ của núi rừng Tây Nguyên.',
    imageQueries: ['Thác Dray Sáp', 'Dray Sap Waterfall', 'Thác Gia Long', 'Gia Long Waterfall Dak Nong'],
  },
  'Thác Phú Cường': {
    description:
      'Thác Phú Cường nằm trên dòng suối Ia Penh thuộc huyện Chư Sê, tỉnh Gia Lai, là một trong những thác nước đẹp và nổi tiếng nhất vùng cao nguyên. Thác cao khoảng 45m, đổ xuống trên nền đá bazan cột được hình thành từ hoạt động núi lửa cổ, tạo nên khung cảnh hùng vĩ và độc đáo.\n\nVào mùa mưa, dòng thác cuồn cuộn tung bọt trắng xóa; mùa khô lại êm đềm len qua vách đá phủ rêu xanh. Xung quanh là đồi núi, nương rẫy và không gian trong lành đặc trưng của phố núi. Du khách đến đây để ngắm thác, cắm trại, chụp ảnh và cảm nhận vẻ đẹp hoang sơ, khoáng đạt của thiên nhiên Gia Lai.',
    imageQueries: ['Thác Phú Cường Gia Lai', 'Thác Phú Cường', 'Chư Sê Gia Lai', 'Phu Cuong Waterfall Gia Lai'],
  },
  'Nhà thờ gỗ Kon Tum': {
    description:
      'Nhà thờ Chính tòa Kon Tum, thường gọi là nhà thờ gỗ, được các linh mục người Pháp xây dựng đầu thế kỷ 20 hoàn toàn bằng gỗ cà chít theo lối kiến trúc Roman kết hợp kiểu nhà sàn của người Ba Na. Đây là công trình biểu tượng và điểm check-in nổi tiếng nhất của phố núi Kon Tum.\n\nToàn bộ nhà thờ với tường đất trộn rơm, khung gỗ, mái ngói và những ô cửa kính màu tạo nên vẻ đẹp cổ kính, ấm áp và hài hòa với bản sắc Tây Nguyên. Trong khuôn viên còn có nhà trưng bày sản phẩm thủ công, cô nhi viện và không gian sinh hoạt của đồng bào dân tộc. Ghé thăm nơi đây, du khách cảm nhận sự giao thoa văn hóa độc đáo giữa phương Tây và núi rừng cao nguyên.',
    imageQueries: ['Kon Tum wooden church', 'Kon Tum cathedral', 'Nha tho go Kon Tum'],
  },
  'Khu du lịch Đại Nam': {
    description:
      'Khu du lịch Lạc Cảnh Đại Nam Văn Hiến ở Bình Dương là một trong những khu du lịch có quy mô lớn nhất Việt Nam, kết hợp hài hòa nhiều loại hình: đền thờ, vườn thú, biển nhân tạo, khu trò chơi và dãy núi Bảo Sơn nhân tạo. Điểm nhấn tâm linh là Kim Điện dát vàng lộng lẫy và đền thờ Đại Nam uy nghi.\n\nKhu vui chơi có hàng loạt trò cảm giác mạnh, biển Đại Nam với bãi cát và sóng nhân tạo, cùng vườn thú safari nuôi nhiều loài động vật quý. Không gian rộng lớn, nhiều hạng mục đa dạng khiến Đại Nam trở thành điểm vui chơi cả ngày lý tưởng cho gia đình và các nhóm khách, chỉ cách TP.HCM khoảng 40km.',
    imageQueries: ['Dai Nam tourist park', 'Lac Canh Dai Nam', 'Dai Nam Binh Duong'],
  },
  'Vườn quốc gia Cát Tiên': {
    description:
      'Vườn quốc gia Cát Tiên là khu rừng nhiệt đới nguyên sinh rộng lớn nằm giữa Đồng Nai, Lâm Đồng và Bình Phước, được UNESCO công nhận là Khu dự trữ sinh quyển thế giới. Đây là mái nhà của hàng nghìn loài động thực vật, trong đó có nhiều loài quý hiếm và khu đất ngập nước Bàu Sấu nổi tiếng.\n\nDu khách khám phá rừng qua các tuyến trekking, đạp xe, xem thú đêm, chèo thuyền trên Bàu Sấu và chiêm ngưỡng cây tung, cây gõ cổ thụ hàng trăm năm tuổi. Vườn còn có trung tâm cứu hộ gấu và linh trưởng cùng đảo tinh tinh. Không gian hoang sơ, trong lành khiến Cát Tiên là điểm đến hàng đầu cho du lịch sinh thái và khám phá thiên nhiên phía Nam.',
    imageQueries: ['Cat Tien National Park', 'Bau Sau Cat Tien', 'Nam Cat Tien forest'],
  },
  'Bạch Dinh Vũng Tàu': {
    description:
      'Bạch Dinh (Villa Blanche) là dinh thự cổ mang phong cách kiến trúc châu Âu, nằm lưng chừng Núi Lớn nhìn ra bãi Trước thành phố Vũng Tàu. Được người Pháp xây dựng cuối thế kỷ 19 làm nơi nghỉ mát cho toàn quyền, dinh từng là nơi vua Thành Thái bị lưu đày và các đời nguyên thủ nghỉ dưỡng.\n\nTòa dinh màu trắng nổi bật giữa rừng cây sứ, hoa đại, với nội thất, đồ trang trí và bộ sưu tập cổ vật vớt từ tàu đắm được trưng bày bên trong. Từ ban công dinh, du khách phóng tầm mắt ngắm biển Vũng Tàu xanh biếc. Bạch Dinh là điểm tham quan lịch sử - kiến trúc đẹp, tiện kết hợp với tượng Chúa Kitô và các bãi biển của thành phố.',
    imageQueries: ['Bach Dinh Vung Tau', 'White Palace Vung Tau', 'Villa Blanche Vung Tau'],
  },
  'Di tích Nhà tù Côn Đảo': {
    description:
      'Hệ thống nhà tù Côn Đảo là "địa ngục trần gian" khét tiếng do thực dân Pháp và đế quốc Mỹ dựng lên để giam cầm những người yêu nước, chiến sĩ cách mạng. Di tích gồm nhiều trại giam như Phú Hải, Phú Sơn cùng những "chuồng cọp" tàn khốc — nơi giam giữ, tra tấn tù nhân trong điều kiện man rợ.\n\nGhé thăm các trại giam, du khách được nghe kể về ý chí kiên trung, bất khuất của bao thế hệ chiến sĩ và viếng nghĩa trang Hàng Dương — nơi yên nghỉ của hàng vạn người, trong đó có nữ anh hùng Võ Thị Sáu. Cùng với thiên nhiên hoang sơ tuyệt đẹp của đảo, Côn Đảo là điểm đến vừa linh thiêng, vừa giàu giá trị lịch sử và tâm linh.',
    imageQueries: ['Con Dao prison', 'Con Dao tiger cages', 'Hang Duong cemetery Con Dao'],
  },
  'Trại rắn Đồng Tâm': {
    description:
      'Trại rắn Đồng Tâm (Trung tâm nuôi trồng, nghiên cứu, chế biến dược liệu Quân khu 9) ở Tiền Giang là nơi nuôi và bảo tồn rắn lớn bậc nhất Việt Nam, đồng thời là cơ sở nghiên cứu, cấp cứu và điều trị rắn cắn cho người dân miền Tây.\n\nDu khách tham quan khu nuôi hàng nghìn con rắn đủ loại từ hiền lành đến kịch độc như hổ mang chúa, cùng bảo tàng rắn trưng bày các mẫu tiêu bản. Trại còn nuôi nhiều loài động vật khác như trăn, cá sấu, gấu, đà điểu, chim quý, tạo nên một vườn thú thu nhỏ. Đây là điểm tham quan giáo dục thú vị, đặc biệt hấp dẫn với trẻ em và những ai tò mò về thế giới bò sát.',
    imageQueries: ['Dong Tam snake farm', 'Dong Tam Tien Giang', 'snake farm Mekong'],
  },
  'Cù lao Thới Sơn': {
    description:
      'Cù lao Thới Sơn (cồn Thới Sơn) là cù lao lớn giữa sông Tiền thuộc thành phố Mỹ Tho, Tiền Giang, nổi tiếng với vườn cây trái sum suê và không gian miệt vườn đặc trưng Nam Bộ. Đây là điểm đến quen thuộc trong các tour du lịch sông nước miền Tây.\n\nĐến Thới Sơn, du khách đi đò trên sông Tiền, chèo xuồng ba lá luồn lách qua những con rạch rợp bóng dừa nước, tham quan vườn trái cây, lò kẹo dừa, trại nuôi ong và thưởng thức trà mật ong, trái cây tươi. Đặc biệt là nghe đờn ca tài tử — di sản văn hóa phi vật thể của nhân loại. Trải nghiệm dân dã, chân chất mang đến cảm nhận trọn vẹn về đời sống miệt vườn sông nước.',
    imageQueries: ['Thoi Son islet My Tho', 'Con Thoi Son', 'Mekong delta My Tho'],
  },
  'Cù lao An Bình': {
    description:
      'Cù lao An Bình là vùng cù lao trù phú nằm giữa sông Tiền và sông Cổ Chiên, thuộc huyện Long Hồ, Vĩnh Long. Bao quanh bởi sông nước và những vườn cây trái quanh năm xanh tốt như chôm chôm, nhãn, bưởi, sầu riêng, nơi đây mang đậm nét đặc trưng của miệt vườn đồng bằng sông Cửu Long.\n\nDu khách qua cù lao bằng phà, sau đó đạp xe hoặc đi xuồng khám phá các vườn trái cây, làng nghề, lò gạch cổ và trải nghiệm lưu trú homestay giữa không gian làng quê. Thưởng thức trái cây tại vườn, nghe đờn ca tài tử, chèo xuồng trong rạch và cùng người dân bắt cá, làm bánh là những trải nghiệm khiến An Bình níu chân du khách phương xa.',
    imageQueries: ['An Binh islet Vinh Long', 'Vinh Long orchard', 'Mekong delta Vinh Long'],
  },
  'Cánh đồng điện gió Bạc Liêu': {
    description:
      'Cánh đồng điện gió Bạc Liêu là một trong những nhà máy điện gió lớn và nổi tiếng nhất Việt Nam, với hàng chục tua-bin gió khổng lồ vươn cao dựng giữa vùng bãi bồi ven biển. Những cột quạt trắng tinh xếp hàng chạy ra tận mép biển tạo nên khung cảnh hùng vĩ, hiện đại và độc đáo hiếm có ở miền Tây.\n\nDu khách đi trên con đường bê tông len giữa các trụ điện gió để chụp ảnh, ngắm hoàng hôn và cảm nhận không gian khoáng đạt của biển trời Bạc Liêu. Đây đã trở thành điểm check-in "sống ảo" hút khách, thường kết hợp cùng nhà Công tử Bạc Liêu, Quán âm Phật đài và khu lưu niệm nhạc sĩ Cao Văn Lầu trong hành trình khám phá vùng đất này.',
    imageQueries: ['Bạc Liêu windpower farm', 'Cánh đồng điện gió Bạc Liêu', 'Điện gió Bạc Liêu', 'Bac Lieu wind farm'],
  },
  'Vườn quốc gia U Minh Hạ': {
    description:
      'Vườn quốc gia U Minh Hạ ở Cà Mau bảo tồn hệ sinh thái rừng tràm ngập nước trên than bùn đặc trưng của vùng cực Nam Tổ quốc. Rừng tràm bạt ngàn cùng hệ động thực vật phong phú, sông rạch chằng chịt tạo nên bức tranh thiên nhiên hoang sơ, bí ẩn của đất rừng phương Nam.\n\nDu khách đi vỏ lãi hoặc xuồng máy len lỏi giữa rừng tràm, tham quan nghề gác kèo ong lấy mật, câu cá, đặt lợp và thưởng thức đặc sản đồng quê như cá lóc nướng trui, lẩu mắm, mật ong rừng. Trải nghiệm chèo xuồng dưới tán tràm, ngắm chim và hòa mình vào cuộc sống dân dã khiến U Minh Hạ trở thành điểm du lịch sinh thái độc đáo của miền Tây.',
    imageQueries: ['Vườn quốc gia U Minh Hạ', 'Rừng U Minh Hạ', 'Rừng tràm U Minh', 'U Minh Ha National Park'],
  },
  'Chùa Hang - Hòn Phụ Tử': {
    description:
      'Chùa Hang (Hải Sơn Tự) ở xã Bình An, huyện Kiên Lương, Kiên Giang là ngôi chùa độc đáo nằm trong lòng núi đá vôi ven biển, với lối đi xuyên qua hang động dẫn ra bãi biển phía sau. Trong hang có nhiều thạch nhũ và tượng Phật, mang không gian linh thiêng, mát lạnh.\n\nNgay trước cửa biển là danh thắng Hòn Phụ Tử — hai khối đá lớn nhỏ tượng trưng cho cha và con, biểu tượng của vùng biển Hà Tiên - Kiên Lương. Du khách viếng chùa, khám phá hang động, tắm biển, ngắm hòn Phụ Tử và những đảo đá nhấp nhô trên biển. Cảnh quan sơn thủy hữu tình cùng giá trị tâm linh khiến nơi đây là điểm đến hấp dẫn của vùng biển Tây Nam.',
    imageQueries: ['Chua Hang Kien Giang', 'Hon Phu Tu', 'Hai Son pagoda Kien Luong'],
  },
};

module.exports = { attractionContent };
