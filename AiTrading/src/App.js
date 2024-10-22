import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { 
  Container, Typography, Grid, Paper, Box, 
  ThemeProvider, createTheme, CssBaseline, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Snackbar, Alert, Slider, TextField, Radio, RadioGroup,
  FormControlLabel, FormControl, FormLabel
} from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import OpenAI from 'openai';
import { motion, AnimatePresence } from 'framer-motion';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

const forexPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'];

const theme = createTheme({
  palette: {
    primary: { main: '#2196f3' },
    secondary: { main: '#f50057' },
    background: { default: '#f5f5f5' },
  },
  typography: {
    h3: { fontWeight: 600 },
    h5: { fontWeight: 500 },
    h6: { fontWeight: 500 },
  },
});

const openai = new OpenAI({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

const TRANSACTION_FEE = 0.001;
const SIMULATION_DURATION = 600;
const INITIAL_BALANCE = 10000;

const App = () => {
  const [marketData, setMarketData] = useState({});
  const [historicalData, setHistoricalData] = useState({});
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [simulationTime, setSimulationTime] = useState(0);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [trades, setTrades] = useState([]);
  const [simulationResults, setSimulationResults] = useState(null);
  const [notification, setNotification] = useState(null);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [aiExplanation, setAiExplanation] = useState('');
  const [tradeAmount, setTradeAmount] = useState(100);
  const [showAiPopup, setShowAiPopup] = useState(false);
  const [showSimpleSurvey, setShowSimpleSurvey] = useState(false);
  const [showDetailedSurvey, setShowDetailedSurvey] = useState(false);
  const [simpleTrustScore, setSimpleTrustScore] = useState('');
  const [detailedTrustScores, setDetailedTrustScores] = useState({});
  const [balanceChange, setBalanceChange] = useState(null);
  const [tradeCount, setTradeCount] = useState(0);
  const [isSurveyActive, setIsSurveyActive] = useState(false);
  const [holdingAmount, setHoldingAmount] = useState(0);
  const [totalAssetValue, setTotalAssetValue] = useState(INITIAL_BALANCE);

  const chartRef = useRef(null);
  const simulationRef = useRef(null);
  const currentDataRef = useRef(null);

  const fetchHistoricalData = useCallback(async () => {
    try {
      setLoading(true);
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 120 * 24 * 60 * 60 * 1000);
      const response = await axios.get(`https://api.frankfurter.app/${startDate.toISOString().split('T')[0]}..${endDate.toISOString().split('T')[0]}?base=EUR&symbols=USD,GBP,JPY,AUD,CAD`);
      
      const newHistoricalData = {};
      Object.entries(response.data.rates).forEach(([date, rates]) => {
        Object.entries(rates).forEach(([currency, rate]) => {
          const pair = `EUR${currency}`;
          if (!newHistoricalData[pair]) {
            newHistoricalData[pair] = [];
          }
          newHistoricalData[pair].push({
            timestamp: new Date(date).getTime(),
            price: 1 / rate
          });
        });
      });

      setHistoricalData(newHistoricalData);
      setLoading(false);
      startSimulation(newHistoricalData[selectedSymbol]);
    } catch (error) {
      console.error('Error fetching historical data:', error);
      setError('Failed to fetch historical data. Please try again later.');
      setLoading(false);
    }
  }, [selectedSymbol]);

  useEffect(() => {
    fetchHistoricalData();
  }, [fetchHistoricalData]);

  const getAIAnalysis = useCallback(async (recentPrices) => {
    if (isSurveyActive) {
      console.log('Survey is active, skipping AI analysis');
      return;
    }

    const priceData = recentPrices.map(p => p.price.toFixed(4)).join(', ');
    const prompt = `As an AI trading assistant, analyze the recent price data for ${selectedSymbol}: [${priceData}]. Should I buy, sell, or hold? Provide a brief, clear explanation for your decision, considering market trends and potential risks.`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 150
      });

      const aiResponse = response.choices[0].message.content.trim();
      
      let action = 'HOLD';
      if (aiResponse.toLowerCase().includes('buy')) {
        action = 'BUY';
      } else if (aiResponse.toLowerCase().includes('sell')) {
        action = 'SELL';
      }

      setAiSuggestion({ action, amount: tradeAmount });
      setAiExplanation(aiResponse);
      if (!isSurveyActive) {
        setShowAiPopup(true);
      }
    } catch (error) {
      console.error('Error getting AI analysis:', error);
      setNotification({ type: 'error', message: 'Failed to get AI suggestion. Using default HOLD decision.' });
      setAiSuggestion({ action: 'HOLD', amount: tradeAmount });
      setAiExplanation('AI explanation unavailable due to an error. Defaulting to HOLD.');
      if (!isSurveyActive) {
        setShowAiPopup(true);
      }
    }
  }, [selectedSymbol, tradeAmount, isSurveyActive]);

  const startSimulation = useCallback((data) => {
    setSimulationTime(0);
    setTrades([]);
    setBalance(INITIAL_BALANCE);
    setSimulationResults(null);
    setTradeCount(0);
    setHoldingAmount(0);
    setTotalAssetValue(INITIAL_BALANCE);

    const simulationData = data.slice(-SIMULATION_DURATION);
    let currentIndex = 0;

    if (simulationRef.current) {
      clearInterval(simulationRef.current);
    }

    simulationRef.current = setInterval(() => {
      if (currentIndex >= simulationData.length) {
        clearInterval(simulationRef.current);
        console.log('Simulation completed');
        analyzeTradingResults();
        return;
      }

      const currentData = simulationData[currentIndex];
      currentDataRef.current = currentData;

      setMarketData(prevData => ({
        ...prevData,
        [selectedSymbol]: currentData
      }));

      setSimulationTime(prevTime => prevTime + 1);

      if (currentIndex % 10 === 0 && !isSurveyActive) {
        getAIAnalysis(simulationData.slice(Math.max(0, currentIndex - 60), currentIndex + 1));
      }
      currentIndex++;
    }, 1000 / simulationSpeed);
  }, [selectedSymbol, simulationSpeed, isSurveyActive, getAIAnalysis]);

  const handleTrade = useCallback((action) => {
    const currentPrice = currentDataRef.current.price;
    const fee = tradeAmount * TRANSACTION_FEE;

    if (action === 'BUY') {
      if (balance >= tradeAmount + fee) {
        const boughtAmount = tradeAmount / currentPrice;
        setBalance(prevBalance => prevBalance - tradeAmount - fee);
        setHoldingAmount(prevHolding => prevHolding + boughtAmount);
        setNotification({ type: 'success', message: `Bought ${boughtAmount.toFixed(4)} ${selectedSymbol} for $${tradeAmount}` });
      } else {
        setNotification({ type: 'error', message: `Not enough balance to buy. Current balance: $${balance.toFixed(2)}` });
        return;
      }
    } else if (action === 'SELL') {
      const maxSellAmount = holdingAmount * currentPrice;
      if (maxSellAmount >= tradeAmount) {
        const soldAmount = tradeAmount / currentPrice;
        setBalance(prevBalance => prevBalance + tradeAmount - fee);
        setHoldingAmount(prevHolding => prevHolding - soldAmount);
        setNotification({ type: 'success', message: `Sold ${soldAmount.toFixed(4)} ${selectedSymbol} for $${tradeAmount}` });
      } else {
        setNotification({ type: 'error', message: `Not enough holdings to sell. Current holdings: ${holdingAmount.toFixed(4)} ${selectedSymbol}` });
        return;
      }
    } else {
      setNotification({ type: 'info', message: 'Decided to hold the position' });
      return;
    }

    setTrades(prevTrades => [...prevTrades, {
      time: simulationTime,
      action,
      amount: tradeAmount,
      price: currentPrice,
      fee: fee
    }]);

    setTradeCount(prevCount => prevCount + 1);
    setShowAiPopup(false);
    setIsSurveyActive(true);
    setShowSimpleSurvey(true);
  }, [balance, simulationTime, selectedSymbol, tradeAmount, holdingAmount]);

  useEffect(() => {
    if (marketData[selectedSymbol]) {
      const currentPrice = marketData[selectedSymbol].price;
      const newTotalAssetValue = balance + (holdingAmount * currentPrice);
      setTotalAssetValue(newTotalAssetValue);
      setBalanceChange({
        amount: Math.abs(newTotalAssetValue - INITIAL_BALANCE),
        isPositive: newTotalAssetValue > INITIAL_BALANCE
      });
    }
  }, [balance, holdingAmount, marketData, selectedSymbol]);

  const analyzeTradingResults = useCallback(() => {
    const finalBalance = totalAssetValue;
    const totalProfit = finalBalance - INITIAL_BALANCE;

    setSimulationResults({
      totalProfit: totalProfit.toFixed(2),
      finalBalance: finalBalance.toFixed(2),
      initialBalance: INITIAL_BALANCE.toFixed(2),
      trades: trades.length,
      outcome: totalProfit > 0 ? 'profit' : totalProfit < 0 ? 'loss' : 'break-even'
    });
  }, [totalAssetValue, trades.length]);

  const handleSimulationSpeedChange = (event, newValue) => {
    setSimulationSpeed(newValue);
    if (simulationRef.current) {
      clearInterval(simulationRef.current);
      startSimulation(historicalData[selectedSymbol]);
    }
  };

  const handleSimpleTrustScoreChange = (event) => {
    setSimpleTrustScore(event.target.value);
  };

  const handleDetailedTrustScoreChange = (question, score) => {
    setDetailedTrustScores(prev => ({ ...prev, [question]: score }));
  };

  const handleTradeAmountChange = (event) => {
    setTradeAmount(Number(event.target.value));
  };

  useEffect(() => {
    if (tradeCount > 0 && tradeCount % 5 === 0) {
      setIsSurveyActive(true);
      setShowDetailedSurvey(true);
    }
  }, [tradeCount]);

  const closeSurvey = () => {
    setShowSimpleSurvey(false);
    setShowDetailedSurvey(false);
    setIsSurveyActive(false);
  };

  if (loading) return <Container><CircularProgress /></Container>;
  if (error) return <Container><Typography color="error">{error}</Typography></Container>;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg">
        <Typography variant="h3" component="h1" gutterBottom>
          AI Trading Assistant
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h5" gutterBottom>Market Data</Typography>
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 0.5 }}
              >
                <Typography variant="h4" sx={{ color: theme.palette.primary.main }}>
                  Current Price: {marketData[selectedSymbol]?.price.toFixed(4) || 'N/A'}
                </Typography>
                <Box display="flex" alignItems="center">
                  <Typography variant="h6">Total Asset Value: ${totalAssetValue.toFixed(2)}</Typography>
                  <AnimatePresence>
                    {balanceChange && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.5 }}
                        style={{ marginLeft: '10px' }}
                      >
                        {balanceChange.isPositive ? (
                          <ArrowUpwardIcon style={{ color: 'green' }} />
                        ) : (
                          <ArrowDownwardIcon style={{ color: 'red' }} />
                        )}
                        <Typography
                          variant="body2"
                          style={{ color: balanceChange.isPositive ? 'green' : 'red' }}
                        >
                          ${balanceChange.amount.toFixed(2)}
                        </Typography>
                      </motion.div>
                    )}









</AnimatePresence>
                </Box>
              </motion.div>
              <Typography>Simulation Time: {Math.floor(simulationTime / 60)}:{(simulationTime % 60).toString().padStart(2, '0')}</Typography>
              <Typography>Cash Balance: ${balance.toFixed(2)}</Typography>
              <Typography>Holdings: {holdingAmount.toFixed(4)} {selectedSymbol}</Typography>
              <TextField
                label="Trade Amount"
                type="number"
                id="user-trade-amount"
                value={tradeAmount}
                onChange={handleTradeAmountChange}
                fullWidth
                margin="normal"
              />
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h5" gutterBottom>Simulation Controls</Typography>
              <Box sx={{ width: '100%' }}>
                <Typography id="simulation-speed-slider" gutterBottom>
                  Simulation Speed
                </Typography>
                <Slider
                  value={simulationSpeed}
                  onChange={handleSimulationSpeedChange}
                  aria-labelledby="simulation-speed-slider"
                  valueLabelDisplay="auto"
                  step={1}
                  marks
                  min={1}
                  max={10}
                />
              </Box>
              <Box sx={{ mt: 2 }}>
                <Button variant="contained" onClick={() => startSimulation(historicalData[selectedSymbol])}>
                  Restart Simulation
                </Button>
              </Box>
            </Paper>
          </Grid>
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h5" gutterBottom>Price Chart</Typography>
              <div ref={chartRef} style={{ width: '100%', height: 400 }}>
                <ResponsiveContainer>
                  <LineChart data={historicalData[selectedSymbol]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString()}
                    />
                    <YAxis domain={['auto', 'auto']} />
                    <Tooltip 
                      labelFormatter={(label) => new Date(label).toLocaleString()}
                      formatter={(value) => value.toFixed(4)}
                    />
                    <Line type="monotone" dataKey="price" stroke={theme.palette.primary.main} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h5" gutterBottom>Trading History</Typography>
              <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                {trades.map((trade, index) => (
                  <Typography key={index}>
                    {new Date(trade.time * 1000).toLocaleTimeString()}: {trade.action} ${trade.amount.toFixed(2)} at ${trade.price.toFixed(4)} (Fee: ${trade.fee.toFixed(2)})
                  </Typography>
                ))}
              </Box>
            </Paper>
          </Grid>
          {simulationResults && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h5" gutterBottom>Simulation Results</Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  {/* <Typography variant="h6">Initial Balance: ${simulationResults.initialBalance}</Typography>
                  <Typography variant="h6">Final Asset Value: ${simulationResults.finalBalance}</Typography>
                  <Typography variant="h6">Total Profit/Loss: ${simulationResults.totalProfit}</Typography>
                  <Typography variant="h6">Total Trades: {simulationResults.trades}</Typography> */}
                  {/* <Typography variant="h6" sx={{ color: simulationResults.outcome === 'profit' ? 'success.main' : simulationResults.outcome === 'loss' ? 'error.main' : 'text.primary' }}>
                    Outcome: {simulationResults.outcome.charAt(0).toUpperCase() + simulationResults.outcome.slice(1)}
                  </Typography> */}
                </Box>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="h6">Final Cash Balance: ${balance.toFixed(2)}</Typography>
                  <Typography variant="h6">Final Holdings: {holdingAmount.toFixed(4)} {selectedSymbol}</Typography>
                  <Typography variant="h6">Final Holdings Value: ${(holdingAmount * marketData[selectedSymbol]?.price).toFixed(2)}</Typography>
                </Box>
              </Paper>
            </Grid>
          )}
        </Grid>
      </Container>

      <Dialog open={showAiPopup && !isSurveyActive} onClose={() => setShowAiPopup(false)}>
        <DialogTitle>AI Analysis and Suggestion</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            AI Explanation: {aiExplanation}
          </Typography>
          <Typography variant="h6" color="primary">
            Based on this analysis, the AI suggests to {aiSuggestion?.action} ${aiSuggestion?.amount}.
          </Typography>
          <TextField
            label="Your Trade Amount"
            type="number"
            id="user-trade-amount"
            value={tradeAmount}
            onChange={handleTradeAmountChange}
            fullWidth
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => handleTrade('BUY')} 
            color="primary" 
            variant={aiSuggestion?.action === 'BUY' ? 'contained' : 'outlined'}
          >
            Buy
          </Button>
          <Button 
            onClick={() => handleTrade('SELL')} 
            color="secondary" 
            variant={aiSuggestion?.action === 'SELL' ? 'contained' : 'outlined'}
          >
            Sell
          </Button>
          <Button 
            onClick={() => handleTrade('HOLD')} 
            variant={aiSuggestion?.action === 'HOLD' ? 'contained' : 'outlined'}
          >
            Hold
          </Button>
          <Button onClick={() => setShowAiPopup(false)}>Ignore</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showSimpleSurvey} onClose={closeSurvey}>
        <DialogTitle>Trust Survey</DialogTitle>
        <DialogContent>
          <FormControl component="fieldset">
            <FormLabel component="legend">How much do you trust the AI-Trader Assistant?</FormLabel>
            <RadioGroup
              aria-label="simple-trust-score"
              name="simple-trust-score"
              value={simpleTrustScore}
              onChange={handleSimpleTrustScoreChange}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                <FormControlLabel key={value} value={value.toString()} control={<Radio />} label={value === 1 ? 'Not at all' : value === 7 ? 'Extremely' : value.toString()} />
              ))}
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSurvey}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showDetailedSurvey} onClose={closeSurvey}>
        <DialogTitle>Detailed Trust Survey</DialogTitle>
        <DialogContent>
          <FormControl component="fieldset">
            <FormLabel component="legend">Based on the information you have so far received about the AI system (AI-Trader Assistant) and your last interactions, please rate each of the following statements:</FormLabel>
            {[
              "I am suspicious of the AI-system's intent, action or, outputs.",
              "I can trust the AI-system.",
              "The AI-system provides security.",
              "I am familiar with the AI-system.",
              "I am confident in the AI-system.",
              "The AI-system is deceptive.",
              "The AI-system behaves in an underhanded manner.",
              "I am wary of the AI-system.",
              "The AI-system's actions will have a harmful or injurious outcome.",
              "The AI-system has integrity.",
              "The AI-system is reliable.",
              "The AI-system is dependable."
            ].map((question, index) => (
              <Box key={index} sx={{ mt: 2 }}>
                <Typography variant="body2">{question}</Typography>
                <RadioGroup
                  row
                  aria-label={`trust-score-${index}`}
                  name={`trust-score-${index}`}
                  value={detailedTrustScores[index] || ''}
                  onChange={(e) => handleDetailedTrustScoreChange(index, e.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                    <FormControlLabel key={value} value={value.toString()} control={<Radio />} label={value === 1 ? 'Not at all' : value === 7 ? 'Extremely' : value.toString()} />
                  ))}
                </RadioGroup>
              </Box>
            ))}
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSurvey}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar 
        open={notification !== null} 
        autoHideDuration={3000} 
        onClose={() => setNotification(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setNotification(null)} severity={notification?.type} sx={{ width: '100%' }}>
          {notification?.message}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
};

export default App;