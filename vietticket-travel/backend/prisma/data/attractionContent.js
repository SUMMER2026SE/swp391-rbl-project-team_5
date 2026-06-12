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
};

module.exports = { attractionContent };
