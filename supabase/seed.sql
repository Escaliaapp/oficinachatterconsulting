-- LOCAL DEVELOPMENT ONLY. Reproducible fixture identities, no passwords or real customers.
-- The browser demo uses its isolated adapter. These Auth rows cannot be signed in with a password.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('20000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','luna@example.test','',now(),'{"provider":"email","providers":["email"]}','{"display_name":"Luna"}',now(),now()),
 ('20000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mateo@example.test','',now(),'{"provider":"email","providers":["email"]}','{"display_name":"Mateo"}',now(),now()),
 ('20000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','studio@example.test','',now(),'{"provider":"email","providers":["email"]}','{"display_name":"Estudio Nómada"}',now(),now()),
 ('20000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','moderator@example.test','',now(),'{"provider":"email","providers":["email"]}','{"display_name":"Alex · Moderación"}',now(),now())
on conflict(id) do nothing;
insert into public.profiles(id,display_name) values
 ('20000000-0000-4000-8000-000000000001','Luna'),('20000000-0000-4000-8000-000000000002','Mateo'),
 ('20000000-0000-4000-8000-000000000003','Estudio Nómada'),('20000000-0000-4000-8000-000000000004','Alex · Moderación') on conflict do nothing;
insert into public.user_roles(user_id,role) values
 ('20000000-0000-4000-8000-000000000001','member'),('20000000-0000-4000-8000-000000000001','subscriber'),
 ('20000000-0000-4000-8000-000000000002','member'),('20000000-0000-4000-8000-000000000002','advertiser'),
 ('20000000-0000-4000-8000-000000000003','member'),('20000000-0000-4000-8000-000000000003','advertiser'),
 ('20000000-0000-4000-8000-000000000004','admin'),('20000000-0000-4000-8000-000000000004','moderator') on conflict do nothing;
insert into public.rooms(id,slug,name) values('10000000-0000-4000-8000-000000000001','jardin-imposible','El jardín de lo imposible') on conflict do nothing;
insert into public.room_members(room_id,user_id,role)
select '10000000-0000-4000-8000-000000000001',id,case when id='20000000-0000-4000-8000-000000000004' then 'moderator' else 'member' end from public.profiles where id::text like '20000000-%' on conflict do nothing;
insert into public.chat_messages(id,room_id,user_id,body,status) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','¿Y si las flores se convirtieran en pequeñas lunas?','approved'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Le di mi voto al jardín de medusas ✨','approved') on conflict do nothing;
insert into public.scene_proposals(id,room_id,author_id,prompt,kind,status,moderation_reason) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Un jardín de medusas luminosas flotando sobre un lago, cine de naturaleza, sin texto.','community','eligible',null),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Una ballena de nubes navega sobre un invernadero de cristal al amanecer.','community','eligible',null),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','Una taza de cerámica artesanal descansa en un jardín imposible, anuncio de Estudio Nómada.','sponsored','eligible',null),
 ('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Un cuaderno de diseño se abre y aparecen flores de papel, anuncio claramente identificado.','sponsored','eligible',null),
 ('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Un bosque de origami que despierta al ritmo de la lluvia.','community','pending_moderation',null),
 ('40000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Ejemplo de propuesta no elegible, sin contenido dañino reproducido.','community','rejected','La solicitud original infringía la política de suplantación. Puedes reformularla o apelar.') on conflict do nothing;
insert into public.votes(proposal_id,user_id) values
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'),
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003'),
 ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001') on conflict do nothing;
insert into public.advertiser_profiles(user_id,business_name,status,reviewed_by,reviewed_at) values
 ('20000000-0000-4000-8000-000000000003','Estudio Nómada (fixture)','approved','20000000-0000-4000-8000-000000000004',now()),
 ('20000000-0000-4000-8000-000000000002','Papel Lunar (fixture)','approved','20000000-0000-4000-8000-000000000004',now()) on conflict do nothing;
insert into public.advertisements(id,advertiser_id,proposal_id,status,disclosure) values
 ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000003','approved','Patrocinado · Estudio Nómada'),
 ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000004','approved','Patrocinado · Papel Lunar') on conflict do nothing;
insert into public.auctions(id,room_id,status,starts_at,ends_at,max_ends_at) values
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','open',now()-interval '1 minute',now()+interval '5 minutes',now()+interval '7 minutes') on conflict do nothing;
select public.grant_purchased_credits('20000000-0000-4000-8000-000000000001',600,'seed:credits:luna','local-fixture');
select public.grant_purchased_credits('20000000-0000-4000-8000-000000000002',1000,'seed:credits:mateo','local-fixture');
select public.grant_purchased_credits('20000000-0000-4000-8000-000000000003',1000,'seed:credits:studio','local-fixture');
insert into public.feature_flags(key,enabled,config) values('h3_max_director',false,'{}'),('demo_activity',false,'{"environment":"local-only"}'),('community_ratio',true,'{"community":80,"sponsored":20}') on conflict do nothing;
