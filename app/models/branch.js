const {
  Repository,
  Reference,
  Branch,
  Signature,
  Merge,
  Index,
  Cred,
} = require('nodegit');

const {
  smembers,
  sadd,
  rpush,
  lrange,
  llen,
  ltrim,
  hsetnx,
  hdel,
} = require('../utils/redis');

const Log = require('../utils/logger');

const getBranchList = async (pathToRepo) => {
  const repo = await Repository.open(pathToRepo);
  const refs = await repo.getReferences(Reference.TYPE.LISTALL);
  const list = await Promise.all(refs.reduce((total, ref) => total.concat(Branch.name(ref)), []));

  return list || [];
};

const getBranchSelected = async (path) => {
  const list = await lrange(path, 0, -1);
  return list || [];
};

const setSelectedBranchList = async (path, list) => {
  const listLength = await llen(path);
  await ltrim(path, listLength, 0);
  await rpush(path, list);
};

const setRecentRepos = async (path) => {
  await sadd('recentRepos', path);
};

const getRecentRepos = async () => {
  const list = await smembers('recentRepos');
  return list || [];
};

const runLightmerge = async (path, list) => {
  const repo = await Repository.open(path);
  const masterCommit = await repo.getMasterCommit();

  const canWrite = await hsetnx(`${path}/lock`, 'lock', 1);
  Log.debug(canWrite);
  const CannotLightmerge = {
    message: 'Other user is lightmerging, please wait!',
  };
  if (canWrite === 0) {
    throw CannotLightmerge;
  }

  Log.debug('Overwrite lightmerge with master');
  await repo.createBranch('lightmerge', masterCommit, true);

  const signature = Signature.default(repo);
  let conflictFiles;
  let conflictBranch;

  /* eslint-disable no-restricted-syntax */
  for (const branch of list) {
    try {
      /* eslint-disable no-await-in-loop */
      await repo.mergeBranches(
        'lightmerge',
        branch,
        signature,
        Merge.PREFERENCE.NO_FASTFORWARD,
        null,
      );
    } catch (index) {
      conflictBranch = branch;

      conflictFiles = [
        ...new Set(
          index
            .entries()
            .filter(entry => Index.entryIsConflict(entry))
            .map(entry => entry.path),
        ),
      ];
    }
  }

  await hdel(`${path}/lock`, 'lock');

  return { conflictBranch, conflictFiles };
};

const pullLatestCode = async (path, username, password) => {
  const repo = await Repository.open(path);

  Log.debug('Pulling the latest code...');
  try {
    await repo.fetchAll({
      callbacks: {
        credentials: () => Cred.userpassPlaintextNew(username, password),
      },
    });
  } catch (e) {
    Log.error(e);
    return e;
  }

  const list = await getBranchList(path);
  const remoteList = list.filter(branch => branch.includes('origin')).filter(branch => !branch.includes('master'));
  remoteList.forEach(async (remoteBranch) => {
    const localBranch = remoteBranch.slice(remoteBranch.indexOf('/') + 1);
    const remoteBranchCommit = await repo.getBranchCommit(remoteBranch);
    await repo.createBranch(localBranch, remoteBranchCommit, true);
  });

  return undefined;
};

const depoly = async (path) => {

};

module.exports = {
  getBranchList,
  getBranchSelected,
  setSelectedBranchList,
  setRecentRepos,
  getRecentRepos,
  runLightmerge,
  pullLatestCode,
  depoly,
};
