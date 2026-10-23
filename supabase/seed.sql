insert into public.cycles(code,name,is_current,status) values ('KMSA_28','KMSA 28',true,'OPEN') on conflict(code) do nothing;
insert into public.secretariats(code,name_ar) values
 ('GS','السكرتارية العامة'),('FIN','السكرتارية المالية'),('EXT','سكرتارية العلاقات الخارجية'),
 ('ACAD','السكرتارية الأكاديمية'),('HEA','سكرتارية التثقيف الصحي'),('SS','السكرتارية الاجتماعية الرياضية'),
 ('CM','السكرتارية الثقافية الإعلامية') on conflict(code) do nothing;
insert into public.system_settings(key,value,description) values
 ('secretary_sla_hours','48'::jsonb,'مهلة مراجعة السكرتير بالساعات'),
 ('gs_sla_hours','48'::jsonb,'مهلة قرار السكرتارية العامة بالساعات'),
 ('current_cycle','"KMSA_28"'::jsonb,'رمز الدورة الحالية'),
 ('due_soon_hours','12'::jsonb,'نافذة تنبيه قرب انتهاء المهلة')
on conflict(key) do nothing;
