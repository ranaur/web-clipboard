# Distributed Clipboard

The program is a distributed clipboard. You can send text, images and files from a computer to another.

# Workflow

Every clipboard is identified by a random string of three BIP-0039 compatible words (see https://github.com/bitcoin/bips/blob/master/bip-0039/bip-0039-wordlists.md).

When you load the page for the first time, the system will create a private/public key pair to identify the machine. The user can have a password in this key, if the user wants.

This pair will be saved in computer cryptographic API if avaliable, or created by javascript and saved in local browser storage. In this case, it must have a password to unlock.

It will try to get the machine's name and user. The user can change the machine's name and his name.

The first page will give two options: create a new clipboard; and connect to an existing clipboard.

For creating a new clipboard, the system will create the random string to identify the clipboard and connect the client to this newly created clipboard. And connects the user to this clipboard, as owner.

For connecting to a clipboard, the system will check if the public key of the client (making a private/public key challenge) is valid and if this public key is allowed to conenct.

Each clipboard can have three user profiles level: owner, user and blocked. Owner approves or rejects each new user, it can aprove it once, with a date limit or indefinitively. Owners have always indefinife access.

Blocked users, of course, can't connect to this clipboard.

The owner also can change the profile of the user to owner, or of an owner to user. He cannot change his own profile level.

Connecting to a clipboard is creating a public/private key pair locally (if it is not already created) sending the public. If you can use the computer's own cryptographis system, better. If not, create in javascript.

Once connected the page will show the type and the contents of current clipboard if feasible (image, text). It must have an option to enable connection to the system clipboard (reading and writing to the system clipboard).

If the content is a file (copied from finder ow windows explorer, for example), the file will be loaded to the clipboard. Every connected client will be notified of this change.

The clipboard can have a history (and a maximumm retention history, both in time and in versions).

When the first client connects to a clipboard (ever a prevously created clipboard that no-one is connected) it creates a shared secret (random).

WHen someone else connects to a running clipboard, after it is allowed, it asks for the shared secret. Anyone that is connected, send it, encrypted with the asker's public key.

When the last client disconnects, every data (from the clipboard) is erased. The only thinkg that is kept (for some time until it is recycled) is the clipboard's name, the public keys allowed and which profile and the approvals.

# Functionalities

Must run in both windows, mac, linux, android ans iphone.

# Architecture

The first version client will be entirely in javascript, running from browser with minimum server support. There can be native versions to lower the system requirements.

All cryptographyc funciotns are executed in the client, never in the serever.

Everything else stored in the server for each clipboard is encrypted by this key. This key can be rotated periodically.

The storage mechanism should be only flatfiles, encrypted by the shard secret. Can be a directory for each clipboard, and a file with the date/time of the clipped data. This file is a json, with the clipboard type and clipboard data.
