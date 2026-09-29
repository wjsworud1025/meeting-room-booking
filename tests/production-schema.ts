import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
assert.equal(process.env.APP_ENV,'local');
const name='booking_schema_test_'+process.pid;const url=new URL(process.env.DATABASE_URL!);url.pathname='/postgres';
const admin=new pg.Client({connectionString:url.toString()});await admin.connect();let created=false;
try{await admin.query(`CREATE DATABASE "${name}"`);created=true;url.pathname='/'+name;const db=new pg.Client({connectionString:url.toString()});await db.connect();try{const sql=readFileSync('scripts/production-schema.sql','utf8');await db.query(sql);await db.query(sql);assert.equal((await db.query('SELECT * FROM public.booking_migrations')).rowCount,2);assert.equal((await db.query('SELECT * FROM booking.members')).rowCount,0);assert.equal((await db.query('SELECT * FROM booking.reservations')).rowCount,0);console.log('PASS: production schema applies twice safely; no sample accounts or reservations.');}finally{await db.end();}}finally{if(created){assert.match(name,/^booking_schema_test_\d+$/);await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);}await admin.end();}
