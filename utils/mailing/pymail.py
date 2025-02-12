import re
import json
import re
import readline
try:
    from tabulate import tabulate
except:
    pass
import imaplib
from email import message_from_bytes
from email.header import decode_header, make_header
import smtplib 
from email.message import Message
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

def clear():
    os.system("cls" if os.name=="nt" else "clear")

class Style:
    # classes
    def __init__(self, enable_color:bool=True):
        self.b = "\33[1m"
        self.d = "\33[2m"
        self.i = "\33[3m"
        self.endc = "\33[0m"
        # colors
        if enable_color:
            self.deep_green = "\33[38;1;96m"
            self.green = "\33[92m"
            self.endc = "\33[0m"
            self.err = "\33[38;1;41m"
            self.warn = "\33[38;1;93m"
        else:
            self.deep_green = ""
            self.green = ""
            self.err = ""
            self.warn = ""

class Credentials:
    def __init__(self, login, password):
        self.login = login
        self.password = password

    def __str__(self):
        password_to_display = "******" if self.password else str(self.password)
        return f"{self.login}, {password_to_display}" 

    def __repr__(self):
        password_to_display = "******" if self.password else str(self.password)
        return f"{self.login}, {password_to_display}" 

class MailClient:
    def __init__(self, credentials, config, silent:bool=False, initialize_smtp:bool=True, initialize_imap:bool=True, content_type:str="plain", enable_colors:bool=True):
        self.content_type=content_type
        self.style = Style(enable_colors)
        self.messages = {}
        self.messages_short = {}
        self.message_counts = {}
        self.debug = False
        self.silent = silent
        self.initialize_smtp = initialize_smtp 
        self.initialize_imap = initialize_imap
        self.initialize_credentials = self.initialize_smtp or self.initialize_imap
        if self.initialize_credentials:
            if not silent:
                clear()
                print("Loading py_mail....")
            self.credentials = credentials
            if self.credentials.password is None:
                raise AssertionError(f"{self.style.err}Password was None! If running from cron, please reffer to README!{self.style.endc}")
            self.config = config
        if initialize_smtp:
            # setup smtp
            try:
                # print("Starting server...")
                self.s = smtplib.SMTP(self.config["smtp"]["server"],
                                       self.config["smtp"]["port"],
                                      timeout=self.config["smtp"]["timeout"]
                                      )
                self.s.starttls()
                self.s.ehlo()
                self.s.login(self.credentials.login, self.credentials.password) # print("Server started!")
            except Exception as e:
                #print(f"""server: '{self.config["smtp"]["server"]}'.""")
                add_e = ""
                if "No address associated with hostname" in str(e):
                    add_e = "Check your internet connection or server configuration!"
                raise AssertionError(f"{self.style.err}Error when connecting to SMTP server! {type(e).__name__}: {e}{self.style.endc}\n{self.style.warn}{add_e}{self.style.endc}")
        # setup IMAP
        if self.initialize_imap:
            try:
                self.i = imaplib.IMAP4_SSL(self.config["imap"]["server"])
                self.i.login(user=self.credentials.login, password=self.credentials.password)
            except Exception as e:
                print(f"{e}Error connecting to IMAP server! {type(e).__name__}: {e}{self.style.endc}")
                input("Press ENTER to continue")
        # Open Favorites
        self.favorites_file = f"{os.getenv('HOME')}/.pymail_favorites.json"
        try:
            with open(self.favorites_file, "r") as f:
                self.favorites = json.load(f)
        except FileNotFoundError:
            with open(self.favorites_file,"w") as f:
                f.write("{}")
                self.favorites = {}
        except Exception as e:
            if not silent:
                print("{err}Could not load 'favorites.json'!{self.style.endc}")
                print(e)

    def __del__(self):
        if not self.initialize_smtp:
            return
        try:
            self.s.quit()
            if not self.silent:
                print("Server connection closed...")
        except AttributeError:
            pass
        except Exception:
            pass

    def show_favorites(self):
        print(f"{self.style.deep_green}=== FAVORITES{self.style.endc}")
        if not len(self.favorites):
            print("\t-no favorites added")
        for k,v in self.favorites.items():
            print(f"\t-{k}\t-{v}")
        self.press_enter()
    
    def add_to_favorites(self):
        print(f"{self.style.deep_green}=== ADD FAVORITES{self.style.endc}")
        mail = input(f"MAIL ADDRESS >>>{self.style.endc} ")
        alias = input(f"ALIAS >>>{self.style.endc} ")
        confirm = True if input(f"Mail: '{mail}', alias: '{alias}'\nDo you confirm? y/n ").lower().startswith("y") else False
        if confirm:
            print(f"{self.style.deep_green}{alias} added to Favorites.{self.style.endc}")
            self.favorites[alias] = mail
        self.save_favorites()
        self.press_enter()

    def remove_from_favorites(self):
        print("{self.style.deep_green}=== REMOVE FAVORITES{self.style.endc}")
        alias = input("ALIAS TO REMOVE >>>{self.style.endc} ")
        if alias not in self.favorites:
            print(f"{self.style.deep_green}There are no '{alias}' in FAVORITES!{self.style.endc}")
            self.press_enter()
            return
        confirm = True if input(f"Mail: '{self.favorites[alias]}', alias: '{alias}'\nDo you confirm deletion? y/n ").lower().startswith("y") else False
        if confirm:
            print(f"{warn}{alias} deleted from Favorites.{self.style.endc}")
            del self.favorites[alias]
        self.save_favorites()
        self.press_enter()

    def save_favorites(self):
        try:
            with open(self.favorites_file, "w") as f:
                f.write(json.dumps(self.favorites, indent=4))
        except Exception as e:
            print(e)
            self.press_enter()

    def _fetch_from_favorites(self, name:str) -> str:
        try:
            return self.favorites[name]
        except KeyError:
            raise KeyError(f"Could not find '{name}' in favorites!")

    def _fetch_all_favorites(self) -> list:
        data = []
        for a,m in self.favorites.items():
            data.append({"alias":a, "mail":m})
        return data


    def _setup_message(self, to, subject, content, content_type="plain") -> MIMEMultipart:
        msg = MIMEMultipart()
        msg["Subject"] = subject
        msg["To"] = to
        content = content.split(sep="\\n")
        content = "\n".join(content)
        msg.attach(MIMEText(content, content_type))
        return msg

    def _send_mail(self, msg):
        self.s.sendmail(self.credentials.login, msg["To"], msg.as_string())

    def send_mail(self):
        try:
            print(f"{self.style.deep_green}=== SEND NEW MAIL{self.style.endc}")
            self.deb("Creating message..")
            msg = MIMEMultipart()
            msg["Subject"] = input(f"{self.style.deep_green}SUBJECT >>>{self.style.endc} ")
            recipients_raw = input(f"{self.style.deep_green}RECIPIENTS >>>{self.style.endc} ").split(",")
            recipients = ",".join([self.favorites[r] if r in self.favorites else r for r in recipients_raw])
            self.deb("set recipients")

            msg["To"] = recipients
            msg.attach(MIMEText(self.collect_multiline(f"{self.style.green}TYPE BODY:"), "plain"))
            self.deb("Sending mail...")
            self._send_mail(msg)
            self.deb("Sent mail...")
            print(f"{self.style.deep_green}Mail sent!{self.style.endc}")
            print(f"recipients: {recipients}")
            self.press_enter()
        except Exception as e:
            print(f"{err}Could not send mail due to:{self.style.endc}\n{self.style.warn}{type(e).__name__}: {e}{self.style.endc}")
            self.press_enter()
            return
    
    def collect_multiline(self, msg):
        print(msg)
        x = input(f">>>{self.style.endc} ")
        inputs = []
        reset_c = 0
        while reset_c < 2:
            inputs.append(x)
            x = input(f"{self.style.green}>>>{self.style.endc} ")
            if x == "":
                reset_c += 1
            else:
                reset_c = 0
        return "\n".join(inputs)
    
    def get_number_of_mails(self, r=0):
        #message_count, total_size = self.p.stat()
        try:
            num_messages = len(self.p.list()[1])
            return num_messages
        except:
            if r > 10:
                raise
            r+=1
            return self.get_number_of_mails(r=r)

        return str(message_count)
    #self.press_enter()

    def press_enter(self):
        input("Press ENTER to continue...")

    def show_inbox(self):
        clear()
        print(f"{self.style.green}=== INBOX {self.style.endc}{self.style.b if self.message_counts['unread'] else self.style.endc}{self.message_counts['unread']}{self.style.endc} unread of {self.message_counts['all']}")
        self._fetch_emails_imap()
        print(tabulate([m for m in self.messages_short], headers="keys"))
        inbox_input = input(self.style.green + "[0] Read {Num} - [1] Reply {Num} - [2] Reload [3] Delete {num} - [9] Exit\n"+ self.style.b + ">>> " + self.style.endc)
        match inbox_input.split(" ")[0].upper():
            case "0" | "READ":
                num = None
                try:
                    num = inbox_input.split(" ")[1]
                    self.open_message(num)
                except IndexError:
                    input(f"{err} There is no message with given num '{num}'!\nPress ENTER to continue{self.style.endc} ")
                finally:
                    self.show_inbox()
            case "1" | "REPLY":
                self.not_implemented()
                self.show_inbox()
            case "2" | "RELOAD":
                self._fetch_emails_imap(hard=True)
                self.show_inbox()
            case "3" | "DELETE":
                self.not_implemented()
                self.show_inbox()
            case "9" | "Q" | "EXIT":
                return
            case _:
                self.invalid(inbox_input)
                self.show_inbox()
    
    def open_message(self, num):
        clear()
        mail = self._get_mail_via_num(num)
        parsed_mail = self._parse_mail(mail)
        print(parsed_mail)
        msg_input = input(self.style.green + "[0] Reply [1] Forward [2] Delete [3] Download {path} [9] Back\n" + self.style.b + ">>> " + self.style.endc)
        match msg_input.upper():
            case "0" | "REPLY":
                self.not_implemented()
                self.open_message(num)
            case "1" | "FORWARD":
                self.not_implemented()
                self.open_message(num)
            case "2" | "DELETE":
                self.not_implemented()
                self.open_message(num)
            case "3" | "DOWNLOAD":
                self.not_implemented()
                self.open_message(num)
            case "4" | "MORE":
                if "[4] MORE" in parsed_mail:
                    self.not_implemented()
                    self.open_message(num)
                else:
                    self.invalid(msg_input)
                    self.open_message(num)
            case "9" | "Q" | "EXIT" | "BACK" :
                return
            case _:
                self.invalid(msg_input)
                self.open_message(num)

    def _parse_mail(self, mail:dict) -> str:
        if mail["Content-Type"].startswith("text/plain"):
            mail_full_content = self._parse_msg_content(mail["Content"])
            mail_content_list = self._split_message(mail_full_content)
            mail_content = mail_content_list[0]
            mail_content_more = mail_content_list[1]
        else:
            pattern = r';[\s\S]*'
            mail_content = self.style.warn + f"< {re.sub(pattern,'',mail['Content-Type'])} not supported yet! Only text/plain is supported! >" + self.style.endc
            mail_content_more = None

        nl = "\n"
        return f"""{self.style.green}{self.style.b}=== Subject:{self.style.endc}{self.style.b}{mail["Subject"]}{self.style.endc}
{self.style.green}= From: {self.style.endc}{mail["From"] if "From" in mail else "---"}
{self.style.green}= To:   {self.style.endc}{mail["To"] if "To" in mail else "---"}
{self.style.green}= Date: {self.style.endc}{mail["Date"] if "Date" in mail else "---"}
{self.style.i}----------------------------------{self.style.endc}
{mail_content}
----------------------------------{nl + self.style.green +"[4] MORE" + self.style.endc if mail_content_more is not None else ""}"""


    def _parse_msg_content(self, content: list[Message] | str | Message) -> str:
        if isinstance(content, Message):
            if content.is_multipart():
                for part in content.get_payload():
                    body = part.get_payload()
                    # more processing?
            else:
                body = content.get_payload()
            return content.get_payload()
        elif isinstance(content, list):
            content = ""
            for m in content:
                content += self._parse_msg_content(m)
        elif isinstance(content, str):
            return content
        else:
            raise TypeError("TypError")

    def _split_message(self, content: str | None) -> list | str:
        if content is None:
            return ["<Message empty or not supported!>", "None"]

        pattern_1 = r"(On (\d+\/\d+\/\d+\s\d+:\d+),[\S\s]+(wrote:))[\s\S]*"
        pattern_2 = r"(?=>)(^(>\s)[\s\S]*)"
        content_list_raw = re.split(pattern_2, content,flags=re.M)
        content_list_1 = re.split(pattern_1, content_list_raw[0])#, flags=re.M)
        content_list = [content_list_1[0], "\n".join(content_list_1[1:] + content_list_raw[1:])]
        while content_list[0].endswith("\n") or content_list[0].endswith("\r"):
            content_list[0] = content_list[0].removesuffix("\n")
            content_list[0] = content_list[0].removesuffix("\r")
        return content_list

    def _get_mail_via_num(self, num:int) -> dict:
        num = int(num)
        for msg in self.messages:
            if msg["Num"] == num:
                return msg


    def _get_number_of_mails(self) -> dict:
        if self.message_counts == {}:
            self._fetch_emails_imap()
        return self.message_counts

    def _fetch_emails_imap(self, hard:bool=False):
        if len(self.messages) != 0:
            if not hard:
                return
        print("Looking for new mails...")
        status, messages = self.i.select('INBOX')    
        if status != "OK": exit("Incorrect mail box")
        
        msg_count = {"all":0, "unread":0}
        msgs = []
        msgs_short = []
        msg_i = 0
        for i in range(1, int(messages[0]) + 1):
            #res, msg = self.i.fetch(str(i), '(RFC822 FLAGS)')  RFC822 makrs msgs Seen
            res, msg = self.i.fetch(str(i), '(BODY.PEEK[] FLAGS)')
            if res != "OK":
                continue
            for response in msg:
                if isinstance(response, tuple):
                    msg = message_from_bytes(response[1])
                    res, flag_data = self.i.fetch(str(i), '(FLAGS)')
                    msg_flags = flag_data[0].decode()
                    msg_seen = '\\Seen' in msg_flags
                    if not msg_seen:
                        msg_count["unread"] +=1
                    msg_count["all"] += 1
                    msg_subject = f"{self.style.endc if msg_seen else self.style.b}" + msg["Subject"] + self.style.endc
                    msg_from = msg["From"]
                    decoded_msg_from = str(make_header(decode_header(msg_from)))
                    decoded_msg_from = re.sub(r"(<)([\s\S])*", "", decoded_msg_from)
                    msgs.append({
                        "Num": msg_i,
                        "Subject": msg_subject,
                        "From": decoded_msg_from,
                        "Content-Type": msg["Content-Type"],
                        "Message-ID": msg["Message-ID"],
                        "Date": msg["Date"],
                        "Content": msg.get_payload()
                                 }
                    )
                    msgs_short.append({
                        "Num": msg_i,
                        "Subject": msg_subject,
                        "From": decoded_msg_from,
                        #"Date": msg["Date"],
                                 }
                    )
                    msg_i += 1
        self.messages = msgs
        self.messages_short = msgs_short
        self.message_counts = msg_count

    def deb(self, msg):
        if self.debug:
            print(msg)

    def not_implemented(self, msg:str=""):
        input(self.style.warn + "Not implemented! press ENTER to continue" + msg + self.style.endc)

    def invalid(self, inp:str, msg:str=""):
        input(self.style.warn + f"Invalid input '{inp}'!" + msg + self.style.endc)



