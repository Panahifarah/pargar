-- Public/community settings defaults + sponsors (admin-editable)

INSERT INTO app_settings (key, value) VALUES
    ('telegram_channel_username', ''),
    ('telegram_channel_title', 'کانال پرگار'),
    ('donation_enabled', 'true'),
    ('donation_note', 'اگر مایلید از مسیر حمایت کنید، وارد شوید و در گفتگو با تیم هماهنگ کنید — جزئیات فقط خصوصی رد و بدل می‌شود.'),
    ('sponsors', '[{"name":"نمونه اسپانسر","url":"https://example.com","blurb":"حامی یادگیری واقعی در پرگار"}]')
ON CONFLICT (key) DO NOTHING;
