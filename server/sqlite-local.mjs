// Local development/testing adapter. Production uses the Sites D1 binding.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function openLocalDatabase(filename=':memory:') {
  const sqlite=new DatabaseSync(filename);
  sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) {
    if(!sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)) {
      sqlite.exec('BEGIN');
      try {sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));sqlite.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(name);sqlite.exec('COMMIT');}
      catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
  }
  function statement(sql,values=[]) {
    return {
      bind(...params){return statement(sql,params);},
      async first(){return sqlite.prepare(sql).get(...values)||null;},
      async all(){return {results:sqlite.prepare(sql).all(...values),success:true};},
      async run(){const row=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(row.changes)},results:[]};},
      _execute(){const query=sqlite.prepare(sql);if(query.columns().length)return {results:query.all(...values),success:true};const result=query.run(...values);return {results:[],meta:{changes:Number(result.changes)},success:true};},
    };
  }
  return {
    prepare:statement,
    async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(stmt=>stmt._execute());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},
    close(){sqlite.close();},
  };
}
