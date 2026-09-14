const test = require('node:test');
const assert = require('node:assert/strict');
const { walkTSTTree } = require('../src/background.js');

test('walkTSTTree - categorizes flat tab list as leaf children', () => {
  const tree = [
    { id: 1, title: 'Tab 1', children: [] },
    { id: 2, title: 'Tab 2', children: [] }
  ];
  const { parents, children, collapsedParents } = walkTSTTree(tree, [], [], []);
  assert.equal(parents.length, 0);
  assert.equal(children.length, 2);
  assert.equal(collapsedParents.length, 0);
  assert.equal(children[0].id, 1);
  assert.equal(children[1].id, 2);
});

test('walkTSTTree - identifies parent nodes and leaf children in nested tree', () => {
  const tree = [
    {
      id: 10,
      title: 'Parent Tab',
      children: [
        { id: 11, title: 'Child Tab A', children: [] },
        { id: 12, title: 'Child Tab B', children: [] }
      ]
    },
    { id: 20, title: 'Independent Leaf Tab', children: [] }
  ];

  const { parents, children, collapsedParents } = walkTSTTree(tree, [], [], []);

  assert.equal(parents.length, 1);
  assert.equal(parents[0].id, 10);
  assert.equal(children.length, 3);
  assert.deepEqual(children.map(c => c.id), [11, 12, 20]);
  assert.equal(collapsedParents.length, 0);
});

test('walkTSTTree - traverses deeply nested multi-level tree hierarchy', () => {
  const tree = [
    {
      id: 1,
      title: 'Grandparent',
      children: [
        {
          id: 2,
          title: 'Parent',
          children: [
            { id: 3, title: 'Grandchild', children: [] }
          ]
        }
      ]
    }
  ];

  const { parents, children, collapsedParents } = walkTSTTree(tree, [], [], []);

  assert.equal(parents.length, 2);
  assert.deepEqual(parents.map(p => p.id), [1, 2]);
  assert.equal(children.length, 1);
  assert.equal(children[0].id, 3);
});

test('walkTSTTree - identifies collapsed subtrees via states array', () => {
  const tree = [
    {
      id: 100,
      title: 'Collapsed Parent',
      states: ['subtree-collapsed'],
      children: [
        { id: 101, title: 'Hidden Child', children: [] }
      ]
    },
    {
      id: 200,
      title: 'Expanded Parent',
      states: [],
      children: [
        { id: 201, title: 'Visible Child', children: [] }
      ]
    }
  ];

  const { parents, children, collapsedParents } = walkTSTTree(tree, [], [], []);

  assert.equal(parents.length, 2);
  assert.equal(collapsedParents.length, 1);
  assert.equal(collapsedParents[0].id, 100);
});

test('walkTSTTree - handles null or empty input safely', () => {
  assert.deepEqual(walkTSTTree(null, [], [], []), { parents: [], children: [], collapsedParents: [] });
  assert.deepEqual(walkTSTTree([], [], [], []), { parents: [], children: [], collapsedParents: [] });
});

test('walkTSTTree - treats nodes without a children property as leaves', () => {
  const tree = [
    { id: 1, title: 'No children property' },
    { id: 2, title: 'Null children', children: null }
  ];

  const result = walkTSTTree(tree);

  assert.deepEqual(result.parents, []);
  assert.deepEqual(result.children.map(node => node.id), [1, 2]);
  assert.deepEqual(result.collapsedParents, []);
});

test('walkTSTTree - records collapsed parents at every nesting level', () => {
  const tree = [{
    id: 1,
    states: ['subtree-collapsed'],
    children: [{
      id: 2,
      states: ['subtree-collapsed'],
      children: [{ id: 3, children: [] }]
    }]
  }];

  const result = walkTSTTree(tree);

  assert.deepEqual(result.parents.map(node => node.id), [1, 2]);
  assert.deepEqual(result.children.map(node => node.id), [3]);
  assert.deepEqual(result.collapsedParents.map(node => node.id), [1, 2]);
});
