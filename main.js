const 
  Telegraf = require('telegraf')
  Extra = require('telegraf/extra')
  Markup = require('telegraf/markup')
  LocalSession = require('telegraf-session-local')
  fs = require('fs')
  csv  = require('csv-parser')
  _ = require('lodash')

const HanziToEnglish = {};
const EnglishToHanzi = {};
const Lessons = [];

fs.createReadStream('dictionary.csv',{start: 1})
.pipe(csv())
.on('data', function(data){
    try {
        //perform the operation
        HanziToEnglish[data["SH"]] = data["RSH Keyword"];
        EnglishToHanzi[data["RSH Keyword"]] = data["SH"];
        Lessons.push({
            hanzi: data["SH"],
            english: data["RSH Keyword"],
            pinyin: data["RTH Read"],
            number: data["RSH #"] || data["SH #"] || Lessons.length,
            lesson:  data["RSH Lesson"]
        });
    }
    catch(err) {
        //error handler
    }
})
.on('end',function(){
    //some final operation
});  

const Bot = new Telegraf(process.env.BOT_TOKEN.replace("_",":")) // Your Bot token here
 
// Name of session property object in Telegraf Context (default: 'session')
const property = 'data'
 
const localSession = new LocalSession({
  // Database name/path, where sessions will be located (default: 'sessions.json')
  database: 'sessions.json',
  // Name of session property object in Telegraf Context (default: 'session')
  property: 'data',
  // Type of lowdb storage (default: 'storageFileSync')
  storage: LocalSession.storageFileAsync,
  // Format of storage/database (default: JSON.stringify / JSON.parse)
  format: {
    serialize: (obj) => JSON.stringify(obj, null, 2), // null & 2 for pretty-formatted JSON
    deserialize: (str) => JSON.parse(str),
  },
  // We will use lowdb instance from LocalSession via Telegraf Context
  state: { }
})
 
// Wait for database async initialization finished (storageFileAsync or your own asynchronous storage adapter)
localSession.DB.then(DB => {
  // Database now initialized, so now you can retrieve anything you want from it
  console.log('Current LocalSession DB:', DB.value())
  // console.log(DB.get('sessions').getById('1:1').value())
})
 
// Telegraf will use `telegraf-session-local` configured above middleware with overrided `property` name
Bot.use(localSession.middleware(property))

Bot.hears(/^max (\d+)$/i, (ctx, next) => {
    ctx[property].max = Math.min(Math.max(parseInt(ctx.match[1] || 0 ),0),Lessons.length)
    ctx.replyWithMarkdown(`Updated \`${ctx.message.from.username}\`'s Max Character Recognition To: \`${ctx[property].max}\``)

    ctx[property].prevRandomIndices = [];
    ctx[property].nextRandomIndices = _.shuffle(_.map(Array(ctx[property].max),(value,index)=>index));
})

Bot.hears(/^range (\d+)[ -]+(\d+)$/i, (ctx, next) => {
    ctx[property].min = Math.min(Math.max(parseInt(ctx.match[1] || 0 ),0),Lessons.length)
    ctx[property].max = Math.min(Math.max(parseInt(ctx.match[2] || ctx[property].min ),ctx[property].min),Lessons.length)
    ctx.replyWithMarkdown(`Updated \`${ctx.message.from.username}\`'s Character Recognition Range To: \`${ctx[property].min}\`-\`${ctx[property].max}\``)

    ctx[property].prevRandomIndices = [];
    ctx[property].nextRandomIndices = _.shuffle(_.map(Array(ctx[property].max-ctx[property].min),(value,index)=>index+ctx[property].min));
})

Bot.hears(/^random (\d+)$/i, (ctx, next) => {
    //Only allow up to max list length
    var random = Math.min(Math.max(parseInt(ctx.match[1] || 0 ),0), ctx[property].max);

    if (random > 0){
        //If we will get to the end of the list
        if(random > ctx[property].nextRandomIndices.length){
            //Shuffle the previous and add to next
            ctx[property].nextRandomIndices = _.concat(ctx[property].nextRandomIndices, _.shuffle(ctx[property].prevRandomIndices));
            ctx[property].prevRandomIndices = [];
        }

        var randomWords = _.slice(ctx[property].nextRandomIndices, 0, random);
        ctx[property].prevRandomIndices = _.concat(ctx[property].prevRandomIndices, randomWords);
        ctx[property].nextRandomIndices = _.slice(ctx[property].nextRandomIndices, random);

        var hanziCharacters = _.map(randomWords,(randomIndex)=>Lessons[randomIndex].hanzi);
        
        ctx.reply(`Showing ${random} Hanzi Characters\n${_.join(hanziCharacters,"\n")}`,
            Extra.markup(
                Markup.keyboard(
                    _.concat(hanziCharacters,[`Random ${random}`])
                        , {
                        wrap: (btn, index, currentRow) => currentRow.length >= 4 || index >= hanziCharacters.length
                    }
                ).resize()
            )
        )
    }
})

Bot.on('text', (ctx, next) => {
  var filteredEnglishWords = _.filter(Lessons.slice(0,ctx[property].max || 0), (entry)=>{
      var entryRegex = new RegExp("([^A-Za-z]|^)"+entry.english+"([^A-Za-z]|$)",'i');
      var searchResult = ctx.message.text.search(entryRegex);
      return searchResult != -1;
  });

  var filteredHanziWords = _.filter(Lessons.slice(0,ctx[property].max || 0), (entry)=>{
    var entryRegex = new RegExp(entry.hanzi,'i');
    var searchResult = ctx.message.text.search(entryRegex);
    return searchResult != -1;
});

  if(filteredEnglishWords.length > 0)
  {
    var hanziCharacters = _.map(filteredEnglishWords,(wordEntry)=>wordEntry.hanzi);

    ctx.reply(`Identified ${hanziCharacters.length} Possible Hanzi Characters\n${_.join(hanziCharacters,"\n")}`,
        Extra.markup(
            Markup.keyboard(
                hanziCharacters, {
                    wrap: (btn, index, currentRow) => currentRow.length >= 4
                }
            ).resize()
        )
    )
  }

  if(filteredHanziWords.length > 0)
  {
    var msg = _.join(
        _.map(filteredHanziWords,(wordEntry)=>{
            return `*${wordEntry.hanzi}*\n*${wordEntry.english}*\n\n_Lesson ${wordEntry.lesson}_\n_Character #${wordEntry.number}_`;
        })
        ,"\n");
    ctx.replyWithMarkdown(msg);
  }

  return next()
})
 
Bot.command('/stats', (ctx) => {
  let msg = `Using session object from [Telegraf Context](http://telegraf.js.org/context.html) (\`ctx\`), named \`${property}\`\n`
  ctx.replyWithMarkdown(msg)
})

Bot.command('/reset', (ctx) => {
  ctx.replyWithMarkdown(`Removing session from database: \`${JSON.stringify(ctx[property])}\``)
  // Setting session to null, undefined or empty object/array will trigger removing it from database
  ctx[property] = null
})
 
Bot.startPolling()