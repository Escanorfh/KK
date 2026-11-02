-- حارس الهدف: استعلام قراءة بس (مفيش فيه أي كتابة) — شغّله قبل أي استيراد أو INSERT
-- الغرض: نتأكد إننا على قاعدة Wasmer (DB_KK) وإن الجداول multi-schema موجودة.
-- لو verdict طلع STOP — متكمّلش: backup.sql فيه TRUNCATE ... RESTART IDENTITY CASCADE على 21 ترابيزة.

SELECT current_database()                                                   AS database,
       count(*) FILTER (WHERE table_schema IN ('core','ops','log')
                          AND table_type = 'BASE TABLE')                    AS efms_tables,
       CASE WHEN current_database() <> 'DB_KK'
                 OR count(*) FILTER (WHERE table_schema IN ('core','ops','log')
                                       AND table_type = 'BASE TABLE') <> 21
            THEN 'STOP — دي مش قاعدة DB_KK الكاملة: متكملش الاستيراد'
            ELSE 'OK — تقدر تنفّذ import_data.sql ثم users.sql'
       END                                                                  AS verdict;
