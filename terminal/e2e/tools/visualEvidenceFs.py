"""Bounded descriptor-relative I/O for immutable visual artifacts (no runtime registry)."""
import base64
import json
import hashlib
import os
import re
import stat
import sys

FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
PACKETS = ("terminal/docs/pr-crops/b-pl-6-batch-1", "terminal/docs/pr-crops/terminal-visual-intelligence")


def parts(value):
    if not isinstance(value, str) or value.startswith('/') or '\\' in value:
        raise ValueError('UNSAFE_PATH')
    out = value.split('/') if value else []
    if any(not re.fullmatch(r'[A-Za-z0-9_.()\[\]@-]+', p) or p in ('.', '..') for p in out):
        raise ValueError('UNSAFE_PATH')
    return out


def open_dir(root, rel, create=False):
    if not isinstance(root, str) or not os.path.isabs(root) or os.path.normpath(root) != root:
        raise ValueError('UNSAFE_DIRECTORY')
    fd = os.open('/', FLAGS)
    try:
        for name in root.split('/')[1:]:
            new = os.open(name, FLAGS, dir_fd=fd)
            os.close(fd)
            fd = new
        for name in parts(rel):
            if create:
                try:
                    os.mkdir(name, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            new = os.open(name, FLAGS, dir_fd=fd)
            os.close(fd)
            fd = new
        return fd
    except BaseException:
        os.close(fd)
        raise


def identity(fd):
    s = os.fstat(fd)
    return [s.st_dev, s.st_ino]


def same_stat(a, b):
    return (a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns, a.st_ctime_ns) == (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns, b.st_ctime_ns)


def main(req):
    root, rel, action = req['root'], req['relative'], req['action']
    if action == 'snapshot':
        locked = set(req['paths'])
        if len(locked) > 4096:
            raise ValueError('SOURCE_BOUND')
        def scan(relative):
            directory = open_dir(root, relative)
            try:
                names = sorted(os.listdir(directory))
                for name in names:
                    if name == '__tests__' and relative != 'terminal/e2e':
                        continue
                    parts(name)
                    item = os.stat(name, dir_fd=directory, follow_symlinks=False)
                    child = relative + '/' + name
                    if stat.S_ISLNK(item.st_mode):
                        raise ValueError('SOURCE_SYMLINK')
                    if stat.S_ISDIR(item.st_mode):
                        scan(child)
                    elif re.search(r'\.(ts|tsx|cjs|mjs|json|py|css|svg)$', name):
                        locked.add(child)
                        if len(locked) > 4096:
                            raise ValueError('SOURCE_BOUND')
            finally:
                os.close(directory)
        for source_root in ('terminal/e2e', 'terminal/app', 'terminal/components', 'terminal/lib'):
            scan(source_root)
        result, total = {}, 0
        for relative in sorted(locked):
            segments = parts(relative)
            encoded = main({'root': root, 'relative': '/'.join(segments[:-1]), 'action': 'read',
                            'name': segments[-1], 'maximum': min(2 * 1024 * 1024, 32 * 1024 * 1024 - total)})
            data = base64.b64decode(encoded, validate=True)
            total += len(data)
            result[relative] = hashlib.sha256(data).hexdigest()
        return result
    if action == 'create_operation':
        if rel not in (p + '/operations' for p in PACKETS) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', req['id']):
            raise ValueError('OPERATION_PATH')
        # The two incumbent packet directories must already exist.
        parent = open_dir(root, rel.rsplit('/', 1)[0])
        try:
            try:
                os.mkdir('operations', 0o700, dir_fd=parent)
            except FileExistsError:
                pass
            target = os.open('operations', FLAGS, dir_fd=parent)
            try:
                os.mkdir(req['id'], 0o700, dir_fd=target)  # EEXIST is never a resume.
                created = os.open(req['id'], FLAGS, dir_fd=target)
                try:
                    created_identity = identity(created)
                    named = os.stat(req['id'], dir_fd=target, follow_symlinks=False)
                    if [named.st_dev, named.st_ino] != created_identity:
                        raise ValueError('DIRECTORY_REPLACED')
                    os.fsync(created)
                    os.fsync(target)
                    return created_identity
                finally:
                    os.close(created)
            finally:
                os.close(target)
        finally:
            os.close(parent)
    fd = open_dir(root, rel)
    try:
        if req.get('identity') is not None and identity(fd) != req['identity']:
            raise ValueError('DIRECTORY_REPLACED')
        if action == 'directory':
            return identity(fd)
        if action == 'list':
            out = []
            for name in sorted(os.listdir(fd)):
                parts(name)
                s = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISLNK(s.st_mode):
                    raise ValueError('SOURCE_SYMLINK')
                out.append({'name': name, 'directory': stat.S_ISDIR(s.st_mode)})
            return out
        name = req.get('name', '')
        if len(parts(name)) != 1:
            raise ValueError('UNSAFE_MEMBER')
        if action in ('write', 'seal'):
            allowed = any(rel.startswith(p + '/operations/') for p in PACKETS)
            if action == 'write' and not allowed:
                allowed = rel in PACKETS and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.composition\.json', name)
            if not allowed:
                raise ValueError('WRITE_SCOPE')
        if action == 'exists':
            try:
                s = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if not stat.S_ISREG(s.st_mode):
                    raise ValueError('MEMBER_TYPE')
                return True
            except FileNotFoundError:
                return False
        if action == 'seal':
            os.fchmod(fd, 0o500)
            os.fsync(fd)
            return True
        if action == 'write':
            data = base64.b64decode(req['bytes'], validate=True)
            if not data or len(data) > 24 * 1024 * 1024:
                raise ValueError('WRITE_BOUND')
            leaf = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400, dir_fd=fd)
            try:
                with os.fdopen(leaf, 'wb', closefd=False) as f:
                    f.write(data)
                    f.flush()
                    os.fsync(f.fileno())
            finally:
                os.close(leaf)
            os.fsync(fd)
            # A renamed directory cannot become an accepted target.
            now = open_dir(root, rel)
            try:
                if identity(now) != identity(fd):
                    raise ValueError('DIRECTORY_REPLACED')
            finally:
                os.close(now)
            return True
        if action == 'read':
            limit = req['maximum']
            if not isinstance(limit, int) or not 0 < limit <= 256 * 1024 * 1024:
                raise ValueError('MEMBER_BOUND')
            leaf = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                before = os.fstat(leaf)
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= limit:
                    raise ValueError('MEMBER_BOUND')
                chunks, remaining = [], before.st_size
                while remaining:
                    data = os.read(leaf, min(remaining, 1024 * 1024))
                    if not data:
                        raise ValueError('MEMBER_SHORT')
                    chunks.append(data)
                    remaining -= len(data)
                if not same_stat(before, os.fstat(leaf)) or not same_stat(before, os.stat(name, dir_fd=fd, follow_symlinks=False)):
                    raise ValueError('MEMBER_CHANGED')
                current_dir = open_dir(root, rel)
                try:
                    if identity(current_dir) != identity(fd):
                        raise ValueError('DIRECTORY_REPLACED')
                finally:
                    os.close(current_dir)
                return base64.b64encode(b''.join(chunks)).decode('ascii')
            finally:
                os.close(leaf)
        raise ValueError('UNKNOWN_ACTION')
    finally:
        os.close(fd)


try:
    raw = sys.stdin.buffer.readline(36 * 1024 * 1024 + 1)
    if len(raw) > 36 * 1024 * 1024 or not raw.endswith(b'\n'):
        raise ValueError('REQUEST_BOUND')
    print(json.dumps({'ok': True, 'value': main(json.loads(raw))}, separators=(',', ':')))
except Exception as exc:
    code = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
    print(json.dumps({'ok': False, 'code': code}, separators=(',', ':')))
    sys.exit(1)
