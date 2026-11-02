-- حارس الهدف: استعلام قراءة بس (مفيش فيه أي كتابة) — شغّله قبل أي استيراد أو INSERT
-- الغرض: نتأكد إننا على قاعدة Wasmer (DB_KK) وإن جداول core/ops/log الـ21 موجودة.
-- لو verdict طلع STOP — متكمّلش: backup.sql فيه TRUNCATE ... RESTART IDENTITY CASCADE على 21 ترابيزة.

SELECT
  (SELECT current_database()) AS database,
  (SELECT count(*)
     FROM information_schema.tables
     WHERE table_schema IN ('core', 'ops', 'log')
       AND table_type = 'BASE TABLE') AS efms_tables,
  CASE
    WHEN (SELECT current_database()) <> 'DB_KK'
      THEN 'STOP — دي مش DB_KK: متكملش الاستيراد'
    WHEN (SELECT count(*)
            FROM information_schema.tables
           WHERE table_schema IN ('core', 'ops', 'log')
             AND table_type = 'BASE TABLE') <> 21
      THEN 'STOP — عدد الجداول مش 21: نفّذ schema.sql الأول'
    ELSE 'OK — تقدر تنفّذ import_data.sql ثم users.sql'
  END AS verdict;
