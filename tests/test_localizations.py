from utils.localizations.localizations import localizations, get_all_translation_keys
import os
import json

l_dir = localizations._path_to_translations


def test_all_localizations_have_the_same_keys():
    # get all localization files
    all_translations = {}
    all_keys = get_all_translation_keys()
    missing = {}

    # load all files

    # check if all files have all txts
    for lang, translations in all_translations.items():
        if len(translations) == len(all_keys):
            continue
        for k in all_keys:
            if k not in translations.keys():
                if missing.get(lang) is None:
                    missing[lang] = []
                missing[lang].append(k)
        assert missing == {}




