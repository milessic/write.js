from localizations import get_all_translation_keys, get_all_translation_files, get_localization_dir
import os
import json
import sys

help_text = """usage:
- python3 generate_new_translation_file -k pl  <- to generate new json with name pl.json
- python3 generate_new_translation_file     <- program will ask you for keycode"""
if __name__ == "__main__":
    # set lang code
    if "-k" in sys.argv and (potential_key_code := sys.argv[sys.argv.index("-k")+1]):
        key_code = potential_key_code
    else:
        key_code = input("provide key code: >> ")
        key_code = key_code.lower().removesuffix(".json")
        if not key_code:
            print("ERROR! Keycode has to be provided!")
            exit(1)

    # check if new file can be created
    already_created = get_all_translation_files()
    fname = key_code + ".json"
    if fname in already_created:
        print("ERROR! Such file is already created!")
        exit(1)
    # create
    fdir = os.path.join(get_localization_dir(), fname)
    keys = get_all_translation_keys()
    empty_locs = dict(
            zip(
                keys,
                ["" for _ in range(len(keys))]
                )
            )
    print(empty_locs)
    json.dump(empty_locs, open(fdir, "w"), indent=4)


    




