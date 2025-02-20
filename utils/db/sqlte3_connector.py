import sqlite3
from time import time
from pathlib import Path

help_text = """sqlie3 python connector and query executor
python3 sqlite3_connector.py [database] [*queries] [options]

\t-h --help\tprints help
\t--godmode\tno query validation, does everything

EXAMPLES:
-create new row and show whole table
--- python3 sqlite3_connector.py my_database.db 'INSERT INTO my_table VALUES ("Hello Wolrd!");SELECT * FROM my_table;'

-won't delete table due to DROP protection
--- python3 sqlite3_connector.py my_database.db 'DROP TABLE my_table'

-this will ommit DROP protection
--- python3 sqlite3_connector.py my_database.db 'DROP TABLE my_table' --godmode"""
class Help(Exception):
    def __init__(self, *args,**kwargs):
        super().__init__(self, *args,**kwargs)

class SqLite3Connector():
    def __init__(self,database:str|Path, safe_mode:bool=True, as_program:bool=False):
        self.as_program = as_program
        self.safe_mode = safe_mode
        self.database = database
        self.verify_db_is_not_empty()

    def execute(self, query:str, *args):
        # split queries
        results = []
        query = query.removesuffix(";")
        queries = query.split(sep=";")
        arguments = args
        if self.as_program and len(queries) != 1 and len(args):
            print("Parameterized queries are supported only for first query!")
        for i,q in enumerate(queries):
            if i > 0:
                arguments = []
            if self.safe_mode and "DROP" in q.upper():
                raise AssertionError("DROP not allowed!")
            try:
                db = self.connect_to_sqlite()
                c = db.cursor()
                if len(arguments):
                    c.execute(q.removesuffix(";") + ";", arguments)
                else:
                    c.execute(q.removesuffix(";") + ";")
                db.commit()
                results.append(c.fetchall())
                c.close()
                db.close()
            except Exception as e:
                results.append([f"ERROR: {type(e).__name__}: {e}], [QUERY:{q}"])
        return results

    def connect_to_sqlite(self):
        try:
            db = sqlite3.connect(self.database)
            return db
        except Exception as e:
            raise AssertionError(f"Could not connect to db due to: {type(e).__name__}: {e}")

    def verify_db_is_not_empty(self):
        query = f'SELECT name FROM sqlite_master WHERE type="table"'
        result = self.execute(query)
        if not len(result):
            raise AssertionError("Db was empty! {result}")

if __name__ == "__main__":
    import sys
    try:
        if "-h" in sys.argv or "--h" in sys.argv:
            raise Help
        t1 = time()
        r = SqLite3Connector(sys.argv[1], safe_mode=False if "--godmode" in sys.argv else True, as_program=True).execute(sys.argv[2])
        t2 = round((time() - t1) * 1000, 2)
    except (IndexError, Help) as e:
        print(help_text)
        exit()
    print(f"=== {len(r)} quries exectued in {t2} miliseconds")
    for i,q in enumerate(r):
        if i > 0:
            print()
        print(q)
