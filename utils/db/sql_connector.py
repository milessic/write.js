import mysql.connector
#from typing imporyUnion
import json

#def connect_to_mysql() -> Union[PooledMySQLConnection, MySQLConnectionAbstract]:

class MySqLConnector:
    def __init__(self):
        try:
            with open("/path/to/your/creds.creds", "r") as f:
                # TODO make it dynamic
                self.creds = json.load(f)
        except:
            raise FileNotFoundError("Please provide a path to the file that is a valid json with keys 'host', 'user', 'password', 'db' to use MySQL!")
    async def connect_to_mysql(self):
        try:
            mydb = mysql.connector.connect(
                    host=self.creds["host"],
                    user=self.creds["user"],
                    password=self.creds["password"],
                    db=self.creds["db"]
                    )
            return mydb
        except:
            return False

    async def execute(self, query:str):
        db = await self.connect_to_mysql()
        c = db.cursor()
        return c.execute(query)
