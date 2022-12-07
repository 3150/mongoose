'use strict';

/**
 * Test dependencies.
 */

const start = require('./common');
const assert = require('assert');
const { fail } = require('assert');

const mongoose = start.mongoose;
const Schema = mongoose.Schema;

const QUERY = 0;
const DOC = 1;
const UNION = 2;
const NEVER = 3;
const TYPE_TO_NAME = ['Query', 'Document', 'Document|Query', 'never'];

describe('pre/post hooks, type of this', function() {
  let db;

  before(function() {
    db = start();
  });

  after(async function() {
    await db.close();
  });

  afterEach(() => require('./util').clearTestData(db));
  afterEach(() => require('./util').stopRemainingOps(db));

  /**
   * One single test for all the different types of hooks. This test is checking the type annotations of hooks in index.d.ts.
   */
  it('dynamic type of this in pre/post hooks', async function() {
    const schema = new Schema({ data: String });
    const signatures = new Map(); // hook name to be called with types with which it has been called

    // register hooks to mongoose and to map in order to check whether hook has been called
    function registerHooks(expThisType /* QUERY, DOC, UNION, NEVER  */, method /* save, updateOne etc. */, options/* ? {document,query} */) {
      for (const hook of ['pre', 'post']) {

        const methods = method instanceof Array ? method : [method];
        // create signature (for messages)
        const hookSignature = [ // not 100% accurate, but good enough for this test
          () => `${hook}<T = Query<any, any>>(method: '${methods.join('\'|\'')}'${options ? ', ' + JSON.stringify(options) : ''}, fn: ${hook[0].toUpperCase()}${hook.slice(1)}MiddlewareFunction<T>): this;`,
          () => `${hook}<T = HydratedDocument<DocType, TInstanceMethods>>(method: '${methods.join('\'|\'')}'${options ? ', ' + JSON.stringify(options) : ''}, fn: ${hook[0].toUpperCase()}${hook.slice(1)}MiddlewareFunction<T>): this;`,
          () => `${hook}<T = HydratedDocument<DocType, TInstanceMethods>|Query<any, any>>(method: '${methods.join('\'|\'')}'${options ? ', ' + JSON.stringify(options) : ''}, fn: ${hook[0].toUpperCase()}${hook.slice(1)}MiddlewareFunction<T>): this;`,
          () => `${hook}<T = never>(method: '${methods.join('\'|\'')}'${options ? ', ' + JSON.stringify(options) : ''}, fn: ${hook[0].toUpperCase()}${hook.slice(1)}MiddlewareFunction<T>): this;`
        ][expThisType]();
        assert(!signatures.has(hookSignature), `hook already registered: ${hookSignature}`);
        signatures.set(hookSignature, new Set());

        // the callback checking the type and registering the call
        const fn = function() {
          let actThisType;
          if (this instanceof mongoose.Query) {
            actThisType = Query;
          } else if (this instanceof mongoose.Document) {
            actThisType = Document;
          } else {
            try {
               actThisType = this.constructor.name;
            } catch(err) {
              actThisType = 'unknown';
            }
          }
      
          switch (expThisType) {
            case QUERY:
            case DOC:
              assert(actThisType === TYPE_TO_NAME[expThisType], `this was ${actThisType}, should be ${TYPE_TO_NAME[expThisType]} for hook ${hookSignature}`); break;
            case UNION: assert(actThisType === 'Document' || actThisType === 'Query', `this was ${actThisType}, should be ${TYPE_TO_NAME[expThisType]} for hook ${hookSignature}`); break;
            case NEVER: fail(`this was ${actThisType}, hook ${hookSignature} should never have been called`); break;
          }
          const calledWith = signatures.get(hookSignature);
          calledWith.add(actThisType);
        };
        // register the hook
        if (options) {
          switch (hook) {
            case 'pre': schema.pre(method, options, fn); break;
            case 'post': schema.post(method, options, fn); break;
          }
        } else {
          switch (hook) {
            case 'pre': schema.pre(method, fn); break;
            case 'post': schema.post(method, fn); break;
          }
        }
      }
    }

    // checks whether all registered hooks have been called
    function checkCalls() {
      const failures = [];
      for (const [hookName, calledWith] of signatures.entries()) {
        const calledWithString = () => {
          if (calledWith.size == 0) return 'never called';
          return 'called with ' + [...calledWith].join(', ');
        };
        if (hookName.indexOf('never') >= 0) {
          if (calledWith.size > 0) {
            failures.push(`hook ${hookName} should never have been called but was ${calledWithString()}.`);
          }
        } else if (hookName.indexOf('|Query') >= 0) { // UNION
          if (!(calledWith.has('Query') && calledWith.has('Document'))) {
            failures.push(`hook ${hookName} should have been called with Document and Query, was ${calledWithString()}.`);
          }
        } else if (hookName.indexOf('Query') >= 0) { // QUERY
          if (!calledWith.has('Query')) {
            failures.push(`hook ${hookName} should have been called with Query, was ${calledWithString()}.`);
          }
        } else if (hookName.indexOf('Document') >= 0) { // DOC
          if (!calledWith.has('Document')) {
            failures.push(`hook ${hookName} should have been called with Document, was ${calledWithString()}.`);
          }
        } else {
          failures.push(`Error in test, do not recognize type of hook ${hookName}`);
        }
      }
      return failures.join('\n    - ');
    }

    // --------------------------------------------------------------------------
    // register hooks; here we actually see the correct type annotations in action
    const MongooseQueryAndDocumentMiddleware = ['remove', 'updateOne', 'deleteOne'];

    const MongooseDistinctDocumentMiddleware = ['validate', 'save', 'init'];
    const MongooseDefaultDocumentMiddleware = [...MongooseDistinctDocumentMiddleware, 'remove'];
    const MongooseDocumentMiddleware = [...MongooseDistinctDocumentMiddleware, ...MongooseQueryAndDocumentMiddleware];

    const MongooseDistinctQueryMiddleware = [
      'count', 'estimatedDocumentCount', 'countDocuments',
      'deleteMany', 'distinct',
      'find', 'findOne', 'findOneAndDelete', 'findOneAndRemove', 'findOneAndReplace', 'findOneAndUpdate',
      'replaceOne', 'update', 'updateMany'];
    const MongooseDefaultQueryMiddleware = [...MongooseDistinctQueryMiddleware, 'updateOne', 'deleteOne'];
    const MongooseQueryMiddleware = [...MongooseDistinctQueryMiddleware, ...MongooseQueryAndDocumentMiddleware];

    const MongooseQueryOrDocumentMiddleware = [
      ...MongooseDistinctQueryMiddleware,
      ...MongooseDistinctDocumentMiddleware,
      ...MongooseQueryAndDocumentMiddleware];

    // first: one method only
    for (const method of MongooseDistinctDocumentMiddleware) {
      registerHooks(DOC, method);
      registerHooks(DOC, method, { document: true, query: false });
      registerHooks(DOC, method, { document: true, query: true });
      registerHooks(NEVER, method, { document: false, query: true });
      registerHooks(NEVER, method, { document: false, query: false });
      // ------------------------------------------------------------
      // always Document (or never, which we do not need to defined in index.d.ts)
    }
    for (const method of MongooseDistinctQueryMiddleware) {
      registerHooks(QUERY, method);
      registerHooks(QUERY, method, { document: false, query: true });
      registerHooks(QUERY, method, { document: true, query: true });
      registerHooks(NEVER, method, { document: true, query: false });
      registerHooks(NEVER, method, { document: false, query: false });
      // ------------------------------------------------------------
      // always Query (or never, which we do not need to defined in index.d.ts)
    }
    for (const method of ['updateOne', 'deleteOne']) { // MongooseDefaultQueryMiddleware w/o distinct
      registerHooks(QUERY, method);
      // defaults to Query
      registerHooks(QUERY, method, { document: false, query: true });
      registerHooks(DOC, method, { document: true, query: false });
      registerHooks(UNION, method, { document: true, query: true });
      registerHooks(NEVER, method, { document: false, query: false });
      // ------------------------------------------------------------
      // When literals are unknown, it is Union of Document|Query (or never, which we do not need to defined in index.d.ts)
    }
    for (const method of ['remove']) { // MongooseDefaultDocumentMiddleware w/o distinct
      registerHooks(DOC, method);
      // defaults to Document
      registerHooks(QUERY, method, { document: false, query: true });
      registerHooks(DOC, method, { document: true, query: false });
      registerHooks(UNION, method, { document: true, query: true });
      registerHooks(NEVER, method, { document: false, query: false });
      // ------------------------------------------------------------
      // When literals are unknown, it is Union of Document|Query (or never, which we do not need to defined in index.d.ts)
    }

    // method arrays
    registerHooks(DOC, MongooseDistinctDocumentMiddleware);
    registerHooks(DOC, MongooseDistinctDocumentMiddleware, { document: true, query: false });
    registerHooks(DOC, MongooseDistinctDocumentMiddleware, { document: true, query: true });
    registerHooks(NEVER, MongooseDistinctDocumentMiddleware, { document: false, query: true });
    registerHooks(NEVER, MongooseDistinctDocumentMiddleware, { document: false, query: false });

    registerHooks(QUERY, MongooseDistinctQueryMiddleware);
    registerHooks(QUERY, MongooseDistinctQueryMiddleware, { document: false, query: true });
    registerHooks(QUERY, MongooseDistinctQueryMiddleware, { document: true, query: true });
    registerHooks(NEVER, MongooseDistinctQueryMiddleware, { document: true, query: false });
    registerHooks(NEVER, MongooseDistinctQueryMiddleware, { document: false, query: false });

    registerHooks(QUERY, MongooseDefaultQueryMiddleware);
    registerHooks(QUERY, MongooseDefaultQueryMiddleware, { document: false, query: true });
    registerHooks(DOC, MongooseDefaultQueryMiddleware, { document: true, query: false });
    registerHooks(UNION, MongooseDefaultQueryMiddleware, { document: true, query: true });
    registerHooks(NEVER, MongooseDefaultQueryMiddleware, { document: false, query: false });

    registerHooks(DOC, MongooseDefaultDocumentMiddleware);
    registerHooks(QUERY, MongooseDefaultDocumentMiddleware, { document: false, query: true });
    registerHooks(DOC, MongooseDefaultDocumentMiddleware, { document: true, query: false });
    registerHooks(UNION, MongooseDefaultDocumentMiddleware, { document: true, query: true });
    registerHooks(NEVER, MongooseDefaultDocumentMiddleware, { document: false, query: false });

    registerHooks(UNION, MongooseDocumentMiddleware);
    registerHooks(QUERY, MongooseDocumentMiddleware, { document: false, query: true });
    registerHooks(DOC, MongooseDocumentMiddleware, { document: true, query: false });
    registerHooks(UNION, MongooseDocumentMiddleware, { document: true, query: true });
    registerHooks(NEVER, MongooseDocumentMiddleware, { document: false, query: false });

    registerHooks(UNION, MongooseQueryMiddleware);
    registerHooks(QUERY, MongooseQueryMiddleware, { document: false, query: true });
    registerHooks(DOC, MongooseQueryMiddleware, { document: true, query: false });
    registerHooks(UNION, MongooseQueryMiddleware, { document: true, query: true });
    registerHooks(NEVER, MongooseQueryMiddleware, { document: false, query: false });

    registerHooks(UNION, MongooseQueryOrDocumentMiddleware);
    registerHooks(QUERY, MongooseQueryOrDocumentMiddleware, { document: false, query: true });
    registerHooks(DOC, MongooseQueryOrDocumentMiddleware, { document: true, query: false });
    registerHooks(UNION, MongooseQueryOrDocumentMiddleware, { document: true, query: true });
    registerHooks(NEVER, MongooseQueryOrDocumentMiddleware, { document: false, query: false });

    // --------------------------------------------------------------------------
    // trigger hooks
    try {
      const Doc = db.model('Test', schema);
      let doc = new Doc({ data: 'value' });
      await doc.save(); // triggers save and validate hooks

      // MongooseDistinctQueryMiddleware
      await Doc.count().exec();
      await Doc.estimatedDocumentCount().exec();
      await Doc.countDocuments().exec();
      await Doc.deleteMany().exec(); await Doc.create({ data: 'value' });
      await Doc.distinct('data').exec();
      await Doc.find({}).exec();
      await Doc.findOne({}).exec();
      await Doc.findOneAndDelete({}).exec(); await Doc.create({ data: 'value' });
      await Doc.findOneAndRemove({}).exec(); await Doc.create({ data: 'value' });
      await Doc.findOneAndReplace({}, { data: 'valueRep' }).exec();
      await Doc.findOneAndUpdate({}, { data: 'valueUpd' }).exec();
      await Doc.replaceOne({}, { data: 'value' }).exec();
      await Doc.update({ data: 'value' }).exec();
      await Doc.updateMany({ data: 'value' }).exec();

      // MongooseQueryOrDocumentMiddleware, use Query
      await Doc.updateOne({ data: 'value' }).exec();
      await Doc.deleteOne({}).exec(); await Doc.create({ data: 'value' });
      await Doc.remove({}).exec(); await Doc.create({ data: 'value' });

      // MongooseQueryOrDocumentMiddleware, use Document
      doc = await Doc.create({ data: 'doc2' });
      await doc.updateOne({ data: 'value' }); // updateOne
      await doc.deleteOne(); doc = await Doc.create({ data: 'doc3' });
      await doc.remove(); doc = await Doc.create({ data: 'doc3' });

      const callResult = checkCalls();
      assert(callResult.length == 0, 'Unexpected hook calls:\n    - ' + callResult);
    } catch (err) {
      assert.fail(err);
    }
  });
});
