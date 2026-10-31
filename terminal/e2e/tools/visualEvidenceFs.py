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


def check_parent(root, rel, fd):
    current = open_dir(root, rel)
    try:
        if identity(current) != identity(fd):
            raise ValueError('DIRECTORY_REPLACED')
    finally:
        os.close(current)


def read_member(fd, name, limit, expected=None):
    if len(parts(name)) != 1 or not isinstance(limit, int) or not 0 < limit <= 256 * 1024 * 1024:
        raise ValueError('MEMBER_BOUND')
    leaf = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        before = os.fstat(leaf)
        if expected is not None and [before.st_dev, before.st_ino] != expected:
            raise ValueError('MEMBER_REPLACED')
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
        return b''.join(chunks), [before.st_dev, before.st_ino]
    finally:
        os.close(leaf)


def guard_start(fd, start):
    if not isinstance(start, dict) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}--start\.json', start.get('name', '')):
        raise ValueError('START_BINDING')
    data, member_identity = read_member(fd, start['name'], 8 * 1024 * 1024, start.get('identity'))
    if member_identity != start.get('identity') or hashlib.sha256(data).hexdigest() != start.get('sha256'):
        raise ValueError('START_BINDING')


def write_exclusive(root, rel, fd, name, data, start=None):
    # The kernel returns the newly-created regular-file descriptor. Never reopen its name to write.
    leaf = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400, dir_fd=fd)
    try:
        offset = 0
        while offset < len(data):
            n = os.write(leaf, memoryview(data)[offset:offset + 1024 * 1024])
            if not n:
                raise ValueError('MEMBER_SHORT')
            offset += n
        os.fsync(leaf)
        before = os.fstat(leaf)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != len(data):
            raise ValueError('MEMBER_CHANGED')
        os.lseek(leaf, 0, os.SEEK_SET)
        offset = 0
        while offset < len(data):
            chunk = os.read(leaf, min(len(data) - offset, 1024 * 1024))
            if not chunk or chunk != data[offset:offset + len(chunk)]:
                raise ValueError('MEMBER_CHANGED')
            offset += len(chunk)
        if not same_stat(before, os.fstat(leaf)) or not same_stat(before, os.stat(name, dir_fd=fd, follow_symlinks=False)):
            raise ValueError('MEMBER_CHANGED')
        if start is not None:
            guard_start(fd, start)
        os.fsync(fd)
        check_parent(root, rel, fd)
        return {'identity': [before.st_dev, before.st_ino], 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    finally:
        os.close(leaf)


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
    if action in ('create_operation', 'seal'):
        raise ValueError('HISTORICAL_READ_ONLY')
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
        start = req.get('start')
        if start is not None:
            guard_start(fd, start)
        if action in ('write', 'create_start'):
            if rel not in PACKETS:
                raise ValueError('WRITE_SCOPE')
            data = base64.b64decode(req['bytes'], validate=True)
            if not data or len(data) > 24 * 1024 * 1024:
                raise ValueError('WRITE_BOUND')
            if action == 'create_start':
                operation_id = req.get('id', '')
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', operation_id) or name != operation_id + '--start.json' or start is not None or len(data) > 8 * 1024 * 1024:
                    raise ValueError('START_BINDING')
                # An orphaned prefix is retained history, never a fresh operation ID.
                with os.scandir(fd) as entries:
                    for count, entry in enumerate(entries):
                        if count >= 16384:
                            raise ValueError('OPERATION_NAMESPACE_BOUND')
                        if entry.name.startswith(operation_id + '--') and '--' not in entry.name[len(operation_id) + 2:]:
                            raise FileExistsError('operation prefix retained')
            elif start is None:
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.composition\.json', name):
                    raise ValueError('WRITE_SCOPE')
            else:
                prefix = start['name'][:-len('start.json')]
                logical = name[len(prefix):] if name.startswith(prefix) else ''
                if not logical or '--' in logical or logical == 'start.json' or logical.endswith('.composition.json'):
                    raise ValueError('WRITE_SCOPE')
            return write_exclusive(root, rel, fd, name, data, start)
        if action == 'exists':
            try:
                s = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if not stat.S_ISREG(s.st_mode):
                    raise ValueError('MEMBER_TYPE')
                check_parent(root, rel, fd)
                if start is not None:
                    guard_start(fd, start)
                return True
            except FileNotFoundError:
                check_parent(root, rel, fd)
                if start is not None:
                    guard_start(fd, start)
                return False
        if action in ('read', 'read_meta'):
            data, member_identity = read_member(fd, name, req['maximum'], req.get('fileIdentity'))
            if start is not None:
                guard_start(fd, start)
            check_parent(root, rel, fd)
            encoded = base64.b64encode(data).decode('ascii')
            if action == 'read_meta':
                return {'bytes': encoded, 'identity': member_identity, 'sha256': hashlib.sha256(data).hexdigest()}
            return encoded
        raise ValueError('UNKNOWN_ACTION')
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.readline(36 * 1024 * 1024 + 1)
        if len(raw) > 36 * 1024 * 1024 or not raw.endswith(b'\n'):
            raise ValueError('REQUEST_BOUND')
        print(json.dumps({'ok': True, 'value': main(json.loads(raw))}, separators=(',', ':')))
    except Exception as exc:
        code = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        print(json.dumps({'ok': False, 'code': code}, separators=(',', ':')))
        sys.exit(1)
