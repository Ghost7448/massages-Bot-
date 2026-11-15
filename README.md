# Discord Announcement Bot

بوت Discord.js v14 لإرسال إعلان من روم تحكم في السيرفر الأساسي إلى أي Text/Announcement channel داخل نفس السيرفر، مع تسجيل العمليات في روم داخل سيرفر لوجات منفصل.

## المتطلبات
- Node.js 20 أو أحدث.
- Bot Application من Discord Developer Portal.
- البوت موجود في السيرفر الأساسي وسيرفر اللوجات.

## التثبيت
1. انسخ `.env.example` وسمّي النسخة `.env`.
2. نفّذ `npm install`.
3. املأ قيم IDs والتوكن في `.env`.
4. شغّل `npm start`.

## إعداد Discord Developer Portal
- فعّل Message Content Intent من صفحة Bot.
- لا تشارك Bot Token ولا ترفعه إلى GitHub.
- أضف البوت للسيرفرين بصلاحيات View Channels وSend Messages وEmbed Links وRead Message History.
- أضف Mention Everyone فقط إذا كنت تريد السماح بهذا النوع من المنشن.

## الإعدادات
- MAIN_GUILD_ID: ID السيرفر الأساسي.
- CONTROL_CHANNEL_ID: روم كتابة الإعلانات.
- ACCESS_ROLE_ID: الرول المسموح لها باستخدام البوت.
- LOGS_GUILD_ID: سيرفر اللوجات المنفصل.
- LOGS_CHANNEL_ID: روم اللوجات.
- CLIENT_ID: Application ID.
- DISCORD_TOKEN: Bot Token.

لتفعيل Developer Mode: User Settings ثم Advanced ثم Developer Mode، وبعدها Copy ID للسيرفر أو الروم أو الرول.

## الاستخدام
1. ابعت نص الإعلان في روم التحكم.
2. اختار التشانل من القائمة أو باستخدام ID.
3. اختار Normal Message أو Embed.
4. اكتب المنشن: اتركه فارغًا، أو اكتب everyone، أو ID رول موجودة في السيرفر الأساسي.
5. راجع Preview واضغط تأكيد الإرسال.

## ملاحظات
- الاختيارات مرتبطة بصاحب الطلب فقط.
- الجلسات مؤقتة في الذاكرة وتنتهي تلقائيًا؛ إعادة تشغيل البوت تلغي الطلبات غير المكتملة.
- اختيار التشانل يقبل Text وAnnouncement داخل السيرفر الأساسي فقط.
- المنشن المسموح به فقط هو الذي تحدده في خانة المنشن؛ المنشنات المكتوبة داخل نص الإعلان لا يتم تفعيلها.
- الرسالة النصية فقط حاليًا؛ المرفقات لا يتم نقلها.
- يجب أن يمتلك البوت View Channel وSend Messages في القنوات، وEmbed Links عند إرسال Embed.
- إرسال @everyone يتطلب صلاحية Mention Everyone.
