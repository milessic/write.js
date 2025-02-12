import os
import json
from watchdog.observers import Observer
from fastapi import Request
from watchdog.events import FileSystemEventHandler



class Localizations:
    def __init__(self, default_lang:str="en", custom_path_to_translations:str|None=None):
        self._translations = {}
        self._default_lang = default_lang
        if custom_path_to_translations is None:
            self._path_to_translations = os.path.join(os.path.dirname(__file__), "translations")
        else:
            self._path_to_translations = custom_path_to_translations
        self._load_all_translations()

        self._observers = {}

    def _load_translations(self, lang:str):
        lang = lang.lower()
        with open(os.path.join(self._path_to_translations, f"{lang}.json"),"r") as f:
            self._translations[lang] = json.load(f)

    def _load_all_translations(self):
        translations_available = os.listdir(self._path_to_translations)
        for f in translations_available:
            if not f.endswith(".json"):
                continue
            f_name = f.removesuffix(".json")
            with open(os.path.join(self._path_to_translations, f),"r") as ft:
                self._translations[f_name] = json.load(ft)

        if not len(self._translations):
            raise ValueError(f"No translations were found!")

    def _set_lang_from_request(self, request:Request|None) -> list[str]:
        if request is None:
            return [self._default_lang,]
        user_langs = request.headers.get("Accept-Language")
        if user_langs is None:
            return []
        return user_langs.split(",")

    def get_with_request(self, txt:str, request:Request|None) -> str:
        user_langs_list = self._set_lang_from_request(request)
        for l in user_langs_list:
            if ( translation := self.get_text(l, txt) ) != txt:
                return translation
        print(txt, self._default_lang)
        return self.get_text(self._default_lang, txt)

    def get_all_from_lang_with_request(self, request:Request) -> dict:
        for l in self._set_lang_from_request(request):
            if ( translations := self._translations.get(l)) is not None:
                return translations
        return self._translations[self._default_lang]

    def get_text(self, lang:str, txt:str) -> str:
        return self._translations.get(lang, {}).get(txt,txt)

    def get_loaded_lang_keys(self) -> list[str]:
        return list(self._translations.keys())

    def get_all_localizations(self) -> dict:
        return self._translations

class TranslationFileWatcher(FileSystemEventHandler):
    def __init__(self, obj:Localizations):
        self.obj = obj

    def on_modified(self, event):
        if (filename := event.src_path).endswith(".json"):
            lang_edited = os.path.basename(filename).removesuffix(".json")
            self.obj._load_translations(lang_edited)

def get_localization_dir():
    return localizations._path_to_translations

def get_all_translation_files() -> list:
    l_dir = get_localization_dir()
    loc_files = os.listdir(l_dir)
    return loc_files

def get_all_translation_keys() -> set:
    all_keys = set()
    all_translations = {}
    l_dir = get_localization_dir()
    loc_files = get_all_translation_files()
    for fname in loc_files:
        fdir = os.path.join(l_dir, fname)
        with open(fdir,"r") as f:
            lang_name = fname.lower().removesuffix(".json")
            all_translations[lang_name] = json.load(f)
            all_keys = {*all_keys, *list(all_translations[lang_name].keys())}
    return all_keys

localizations = Localizations()
observer = Observer()
event_handler = TranslationFileWatcher(localizations)
observer.schedule(event_handler, path=localizations._path_to_translations, recursive=False)
observer.start()

